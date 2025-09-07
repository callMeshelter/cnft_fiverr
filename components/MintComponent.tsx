/* eslint-disable react-hooks/rules-of-hooks */

import {
  Box,
  Button,
  createStandaloneToast,
  useToast,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

import {
  fetchTreeConfigFromSeeds,
  findLeafAssetIdPda,
  mintToCollectionV1,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  keypairIdentity,
  publicKey,
  generateSigner,
  percentAmount,
  PublicKey as UmiPublicKey,
  some,
} from "@metaplex-foundation/umi";
import { createNft } from "@metaplex-foundation/mpl-token-metadata";
import { Keypair } from "@solana/web3.js";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { useWallet } from "@solana/wallet-adapter-react";
import axios from "axios";

// ====== PARAMS ======
const TOTAL_NFTS = 20000;          // taille d'une collection marketing
const sellerFeeBasisPoints = 550;  // 5.5%
const MERKLE_TREE = publicKey(process.env.NEXT_PUBLIC_MERKLETREE as string);

// ====== RATE LIMIT : 2 tx / seconde ======
const MAX_TX_PER_SEC = 6;
const SCHEDULER_TICK_MS = 1000;
// =========================================

let txList: { cnft: string; address: string }[] = [];

export function MyButtonList({
  umi,
  setTxList,
  isConnected,
}: any): JSX.Element {
  // ---- UI state
  const [collectionMinted, setCollectionMinted] = useState<number>(0); // compteur dans la collection courante
  const [treeMinted, setTreeMinted] = useState<number>(0);             // total minté dans l'arbre (info)
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [amoutToMint, setAmoutToMint] = useState(1);

  // collection courante (🔁 peut changer) — source de vérité côté client
  const [currentCollection, setCurrentCollection] = useState<UmiPublicKey>(
    publicKey(process.env.NEXT_PUBLIC_COLLECTION as string)
  );

  // refs techniques
  const queueRef = useRef<string[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const inTickRef = useRef(false);
  const nextLeafIndexRef = useRef<number>(0);      // index global dans l'arbre
  const rotatingRef = useRef(false);               // evite double création collection
  const collectionMintedRef = useRef<number>(0);
  const collectionPkRef = useRef<UmiPublicKey>(currentCollection);

  const toast = useToast();
  const { connected, publicKey: myAddress } = useWallet();

  // ⚠️ authority (doit avoir droits sur collection + tree)
  const SECRET_KEY = Uint8Array.from(
    [40,246,180,188,254,236,192,50,53,91,83,77,148,203,238,227,156,14,0,72,169,70,17,42,150,141,178,219,74,63,89,13,157,57,121,106,211,248,255,192,248,227,155,1,51,159,19,179,248,120,188,105,19,155,165,206,148,214,41,29,251,2,28,253]
  );

  const getOwnerUmi = () => {
    const keypair = Keypair.fromSecretKey(SECRET_KEY);
    const umiKeypair = fromWeb3JsKeypair(keypair);
    return umi.use(keypairIdentity(umiKeypair));
  };

  // --- Boot: priorité à .env, puis fallback localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const envStr = process.env.NEXT_PUBLIC_COLLECTION as string | undefined;

    if (envStr) {
      try {
        const pk = publicKey(envStr);
        setCurrentCollection(pk);
        collectionPkRef.current = pk;
        // écrase le localStorage avec la valeur .env (source de vérité)
        localStorage.setItem("currentCollection", pk.toString());
        return; // on s'arrête ici si .env présent
      } catch {
        // si .env invalide, on tombera sur le fallback localStorage ci-dessous
      }
    }

    // fallback: localStorage (si pas/plus de .env valide)
    const saved = localStorage.getItem("currentCollection");
    if (saved) {
      try {
        const pk = publicKey(saved);
        setCurrentCollection(pk);
        collectionPkRef.current = pk;
      } catch {
        // rien, on gardera la valeur par défaut du state
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync refs
  useEffect(() => { collectionPkRef.current = currentCollection; }, [currentCollection]);
  useEffect(() => { collectionMintedRef.current = collectionMinted; }, [collectionMinted]);

  // ---- lecture fichier d'adresses
  const getAddressesFromList = async () => {
    try {
      const x = await axios.get("/api/read", { timeout: 10000 });
      const addrs: string[] = (x.data?.addresses || [])
        .map((s: string) => s.trim())
        .filter(Boolean);

      const q = queueRef.current;
      let appended = 0;
      for (const a of addrs) {
        if (!seenRef.current.has(a)) {
          seenRef.current.add(a);
          q.push(a);
          appended++;
        }
      }
      if (appended > 0) {
        createStandaloneToast().toast({
          title: `${appended} adresses ajoutées à la file.`,
          status: "success",
          duration: 300,
        });
      }
    } catch (e) {
      console.error("GET /api/read failed:", e);
    }
  };

  // ---- fetch état initial (tree + progress collection courante via modulo)
  const handleFetchMerkleTree = async () => {
    const cfg = await fetchTreeConfigFromSeeds(umi, { merkleTree: MERKLE_TREE });
    const num = Number(cfg.numMinted);          // total minted dans l'arbre
    const inThisCollection = num % TOTAL_NFTS;  // progress de la collection courante (cyclique)

    setTreeMinted(num);
    setCollectionMinted(inThisCollection);
    nextLeafIndexRef.current = num;
  };

  // ---- Création d'une NOUVELLE collection (auto-rotation)
  const rotateCollection = async () => {
    if (rotatingRef.current) return;
    rotatingRef.current = true;

    try {
      const ownerUmi = getOwnerUmi();
      const newMint = generateSigner(ownerUmi);

      await createNft(ownerUmi, {
        mint: newMint,
        name: "Ticket",
        uri: "https://gateway.irys.xyz/EeMKBNhtBuZpoLjfaKRVc72MEGkNcCgXF7oKMLpzsnhz",
        sellerFeeBasisPoints: percentAmount(5.5), // 5.5%
        isCollection: true,
      }).sendAndConfirm(ownerUmi);

      // 1) Bascule immédiate côté client (source de vérité "live")
      setCurrentCollection(newMint.publicKey);
      setCollectionMinted(0);
      // 2) Persistance locale (sur ce navigateur)
      if (typeof window !== "undefined") {
        localStorage.setItem("currentCollection", newMint.publicKey.toString());
      }

      createStandaloneToast().toast({
        title: "Nouvelle collection créée",
        description: newMint.publicKey.toString(),
        status: "success",
        duration: 4000,
        isClosable: true,
      });
    } catch (e) {
      console.error("rotateCollection error:", e);
      createStandaloneToast().toast({
        title: "Échec création de collection",
        status: "error",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      rotatingRef.current = false;
    }
  };

  // ---- Envoi SANS await (fire-and-forget)
  const fireAndForgetMint = (addr: string) => {
    try {
      const keypair = Keypair.fromSecretKey(SECRET_KEY);
      const ownerUmi = getOwnerUmi();

      // si la collection courante est complète -> on déclenche la rotation
      if (collectionMintedRef.current >= TOTAL_NFTS) {
        void rotateCollection();
        return; // on ne mint pas cette adresse pendant la rotation
      }

      const currentNumber = nextLeafIndexRef.current; // index global (arbre)
      const colIndex = (collectionMintedRef.current % TOTAL_NFTS) + 1; // # dans collection

      const builder = mintToCollectionV1(ownerUmi, {
        collectionAuthority: ownerUmi.identity,         // 👈 signer (pas .publicKey)
        leafOwner: publicKey(addr),
        merkleTree: MERKLE_TREE,
        collectionMint: collectionPkRef.current,        // 👈 collection courante "live"
        metadata: {
          name: "Ticket #" + colIndex,
          symbol: "Ticket",
          uri: "https://gateway.irys.xyz/EeMKBNhtBuZpoLjfaKRVc72MEGkNcCgXF7oKMLpzsnhz",
          sellerFeeBasisPoints,
          collection: some({ key: collectionPkRef.current, verified: true }),
          creators: [
            {
              address: publicKey(keypair.publicKey.toString()),
              share: 100,
              verified: true,
            },
          ],
        },
      });

      // envoi sans attendre confirmation
      void builder.send(ownerUmi)
        .then((sig) => {
          console.log("✅ sent:", sig, "to", addr);
        })
        .catch((err) => {
          console.error("❌ send failed for", addr, err);
          createStandaloneToast().toast({
            title: `Send failed for ${addr}`,
            status: "error",
            duration: 6000,
            isClosable: true,
          });
        });

      // feedback immédiat
      createStandaloneToast().toast({
        title: `Submitted tx to ${addr}`,
        status: "success",
        duration: 200,
      });

      // retire du fichier côté serveur (si ton /api/remove est en place)
      void axios.post("/api/remove", { address: addr }, { timeout: 10000 })
        .catch((e) => console.warn("POST /api/remove failed:", e));

      // asset id (UI) basé sur l'index global courant
      const [assetId] = findLeafAssetIdPda(umi, {
        merkleTree: MERKLE_TREE,
        leafIndex: currentNumber,
      });
      txList.push({ cnft: assetId, address: addr });
      console.log(currentNumber + 1, ". Minted (submitted): ", assetId, " for ", addr);

      // MAJ compteurs
      nextLeafIndexRef.current = currentNumber + 1;
      setTreeMinted((n) => n + 1);
      setCollectionMinted((n) => {
        const next = n + 1;
        // si on atteint EXACTEMENT TOTAL_NFTS -> on lance la rotation
        if (next >= TOTAL_NFTS) {
          void rotateCollection();
        }
        return next % TOTAL_NFTS;
      });
    } catch (error) {
      console.error("builder error:", error);
      createStandaloneToast().toast({
        id: "no-cm",
        title: "Error building tx",
        status: "error",
        duration: 6000,
        isClosable: true,
      });
    }
  };

  // ---- Scheduler 2 tx/s
  useEffect(() => {
    const poller = setInterval(getAddressesFromList, 3000);
    getAddressesFromList();

    const scheduler = setInterval(() => {
      if (inTickRef.current) return;
      const q = queueRef.current;
      if (q.length === 0) return;

      inTickRef.current = true;

      const batch: string[] = [];
      while (batch.length < MAX_TX_PER_SEC && q.length > 0) {
        const addr = q.shift() as string;
        batch.push(addr);
      }

      if (batch.length > 0) {
        setLoading(true);
        setLoadingText(`Submitting ${batch.length} tx(s) (6/s)…`);
        for (const addr of batch) fireAndForgetMint(addr);
      }

      if (queueRef.current.length === 0) {
        setLoading(false);
        setLoadingText("");
      }
      inTickRef.current = false;
    }, SCHEDULER_TICK_MS);

    return () => {
      clearInterval(poller);
      clearInterval(scheduler);
    };
  }, []);

  // ---- init fetch
  useEffect(() => {
    if (!connected) return;
    (async () => {
      await handleFetchMerkleTree();
    })();
  }, [umi, connected]);

  // ---- Bouton “self” (dédup)
  const handleMintWithCollection = async () => {
    if (!myAddress || !myAddress.toString()) return;
    const addr = myAddress.toString();
    if (!seenRef.current.has(addr)) {
      seenRef.current.add(addr);
      queueRef.current.push(addr);
      createStandaloneToast().toast({
        title: `1 adresse ajoutée à la file (6 tx/s, sans attente).`,
        status: "success",
        duration: 200,
      });
    } else {
      createStandaloneToast().toast({
        title: `Adresse déjà en file (dédup activée).`,
        status: "info",
        duration: 200,
      });
    }
  };

  // forcer la collection depuis .env à la volée
  const forceEnvCollection = () => {
    try {
      const envStr = process.env.NEXT_PUBLIC_COLLECTION as string;
      const pk = publicKey(envStr);
      setCurrentCollection(pk);
      collectionPkRef.current = pk;
      if (typeof window !== "undefined") {
        localStorage.setItem("currentCollection", pk.toString());
      }
      createStandaloneToast().toast({
        title: "Collection rechargée depuis .env",
        description: pk.toString(),
        status: "success",
        duration: 2500,
      });
    } catch {
      createStandaloneToast().toast({
        title: "Valeur .env invalide",
        status: "error",
        duration: 2500,
      });
    }
  };

  // ---- UI contrôles
  const controls = (
    <Box style={{ display: "block" }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          background: "#F8F9FB",
          border: "1px solid #E7E8EC",
          padding: 14,
          borderRadius: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: "#6B7280",
              marginBottom: 6,
              letterSpacing: ".2px",
            }}
          >
            Quantité à minter
          </label>
          <input
            type="number"
            min={1}
            value={amoutToMint}
            onChange={(e) => setAmoutToMint(Number(e.target.value))}
            style={{
              width: "100%",
              background: "#FFFFFF",
              border: "1px solid #E7E8EC",
              borderRadius: 12,
              fontSize: 16,
              padding: "12px 14px",
              outline: "none",
            }}
          />
        </div>

        <Button
          onClick={handleMintWithCollection}
          loadingText={loadingText || "Envoi…"}
          isLoading={loading}
          disabled={!isConnected}
          size="md"
          style={{
            height: 44,
            padding: "0 18px",
            borderRadius: 12,
            background: "#111111",
            color: "#FFFFFF",
            fontWeight: 600,
            boxShadow: "0 2px 8px rgba(0,0,0,.08)",
          }}
        >
          Mint
        </Button>

        <Button
          onClick={forceEnvCollection}
          variant="outline"
          size="md"
          style={{
            height: 44,
            padding: "0 14px",
            borderRadius: 12,
            background: "#FFFFFF",
            color: "#111111",
            fontWeight: 600,
            border: "1px solid #E7E8EC",
          }}
        >
          Recharger depuis .env
        </Button>
      </div>
    </Box>
  );

  const remaining = Math.max(0, TOTAL_NFTS - collectionMinted);

  return (
    <>
      <div
        className="tw-pt-4 empty:tw-py-0 tw-border-t empty:tw-border-t-0"
        style={{ maxWidth: "560px", margin: "0 auto" }}
      >
        <div className="tw-flex tw-flex-col tw-gap-y-4">
          <div
            className="tw-flex tw-flex-col tw-gap-5"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E7E8EC",
              borderRadius: 24,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              padding: 20,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: "-0.2px",
                  }}
                >
                  cNFT Sender
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#6B7280",
                    marginTop: 2,
                  }}
                >
                  Simple, propre, limite à 2 tx/s
                </div>
              </div>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#EAFBE7",
                  color: "#167C2E",
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: "#22C55E",
                    borderRadius: "50%",
                  }}
                />
                Live
              </div>
            </div>

            {/* Stats (progress de la collection courante) */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  color: "#5B5B62",
                  marginBottom: 8,
                }}
              >
                <span>Progression de la collection</span>
                <span style={{ fontWeight: 600, color: "#111" }}>
                  {((collectionMinted * 100) / TOTAL_NFTS).toFixed(0)}%{" "}
                  <span style={{ color: "#6B7280", fontWeight: 400 }}>
                    ( <b>{collectionMinted}</b> / {TOTAL_NFTS} )
                  </span>
                </span>
              </div>

              <div
                className="progress-bar__container"
                style={{ height: 8, background: "#F1F2F6", borderRadius: 999 }}
              >
                <div
                  className="progress-bar__value"
                  style={{
                    width: ((collectionMinted * 100) / TOTAL_NFTS).toFixed(3) + "%",
                    height: 8,
                    background: "#111111",
                    borderRadius: 999,
                    transition: "width .4s ease",
                  }}
                />
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#6B7280" }}>
                Collection actuelle:&nbsp;
                <b style={{ color: "#111" }}>{(currentCollection as any).toString()}</b>
                <span style={{ marginLeft: 10, color: "#9CA3AF" }}>
                  • Restants:&nbsp;<b style={{ color: "#111" }}>{remaining}</b>
                </span>
              </div>
            </div>

            {/* Contrôles */}
            {controls}
          </div>
        </div>
      </div>

      {/* Historique */}
      <div
        style={{
          maxWidth: "560px",
          margin: "16px auto 0",
          background: "#FFFFFF",
          border: "1px solid #E7E8EC",
          borderRadius: 24,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEE" }}>
          <h2
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.1px",
            }}
          >
            Transactions récentes
          </h2>
        </div>

        <div
          style={{
            maxHeight: 420,
            overflowY: "auto",
            padding: "6px 0",
          }}
        >
          {txList.length === 0 ? (
            <div
              style={{
                padding: "36px 18px",
                textAlign: "center",
                color: "#6B7280",
                fontSize: 13,
              }}
            >
              Aucune transaction pour le moment.
            </div>
          ) : (
            txList.map((x, i) => (
              <div key={i} style={{ padding: "10px 18px" }}>
                <p style={{ margin: 0, fontSize: 13 }}>
                  cNFT:&nbsp;
                  <a
                    style={{ color: "#2563EB", textDecoration: "none" }}
                    target="_blank"
                    href={`https://orb.helius.dev/address/${x.cnft}?cluster=mainnet`}
                    rel="noreferrer"
                  >
                    {x.cnft}
                  </a>
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#4B5563" }}>
                  Destinataire:&nbsp;
                  <a
                    style={{ color: "#2563EB", textDecoration: "none" }}
                    target="_blank"
                    href={`https://orb.helius.dev/address/${x.address}/history?cluster=mainnet&page=1`}
                    rel="noreferrer"
                  >
                    {x.address}
                  </a>
                </p>

                {i < txList.length - 1 && (
                  <div
                    style={{ height: 1, background: "#F1F2F6", marginTop: 12 }}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
