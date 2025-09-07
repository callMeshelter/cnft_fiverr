/* eslint-disable react-hooks/rules-of-hooks */

import {
  generateSigner,
  percentAmount,
  publicKey,
  some,
} from "@metaplex-foundation/umi";
import { createNft } from "@metaplex-foundation/mpl-token-metadata";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useUmi } from "../utils/useUmi";
import { useToast } from '@chakra-ui/react';

import {
  createTree,
  mintToCollectionV1,
  fetchTreeConfigFromSeeds,
} from '@metaplex-foundation/mpl-bubblegum';
import { fetchMerkleTree } from "@metaplex-foundation/mpl-account-compression";

export const TOKEN_DECIMAL = 6;
export const collection = 'Dfw8rEiqCvjuPZmCfHHEsyPY5PuAfPYWrgX4QSJQDgw8';
export const website = 'https://www.fiverr.com/ashar_web3/build-solana-compressed-nft-mint-site-bubblegum-v2-cnft-mint';
export const telegram = 'https://www.fiverr.com/ashar_web3/build-solana-compressed-nft-mint-site-bubblegum-v2-cnft-mint';
export const discord = 'https://www.fiverr.com/ashar_web3/build-solana-compressed-nft-mint-site-bubblegum-v2-cnft-mint';

import { MyButtonList } from "@/components/MintComponent";

const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

// === Paramètres d'arbre V1 (1M feuilles) ===
const MAX_DEPTH = 14;    // 2**20 = 1,048,576 feuilles
const MAX_BUFFER = 64;  // combo sûr pour depth 20 (évite 0x1799)
const CANOPY = 0;        // V1: on laisse 0

// Helper: extraire proprement les logs d'une SendTransactionError
const extractLogs = async (e: any): Promise<string[]> => {
  try {
    if (typeof e?.getLogs === 'function') {
      const l = await e.getLogs();
      return Array.isArray(l) ? l : [];
    }
    if (Array.isArray(e?.logs)) return e.logs;
    if (e?.cause?.logs) return e.cause.logs as string[];
  } catch {}
  return [];
};

export default function Home() {
  const umi = useUmi();
  const toast = useToast();

  const [walletConnected, setWalletConnected] = useState(false);
  const [txList, setTxList] = useState<{ cnft: string; address: string }[]>([]);

  useEffect(() => {
    if (umi?.identity?.publicKey && umi.identity.publicKey !== '11111111111111111111111111111111') {
      setWalletConnected(true);
    } else {
      setWalletConnected(false);
    }
  }, [umi]);

  const [merkleTree, setmerkleTree] = useState(process.env.NEXT_PUBLIC_MERKLETREE as string);
  const [collectionMint, setCollectionMint] = useState(process.env.NEXT_PUBLIC_COLLECTION as string);

  const handleCreateTreeV1 = async () => {
    try {
      console.log('RPC:', umi.rpc.getEndpoint());

      const merkleTreeSigner = generateSigner(umi);

      // Création de l’arbre Bubblegum V1
      const builder = await createTree(umi, {
        merkleTree: merkleTreeSigner,
        maxBufferSize: MAX_BUFFER,
        maxDepth: MAX_DEPTH,
        public: true,
      });

      // (Optionnel) simuler pour lire les logs sans envoyer:
      // const signed = await builder.buildAndSign(umi);
      // const sim = await umi.rpc.simulate(signed);
      // console.log('SIM LOGS:', sim.logs);

      const sig = await builder.sendAndConfirm(umi);
      console.log('Tree created:', merkleTreeSigner.publicKey.toString(), sig);

      setmerkleTree(merkleTreeSigner.publicKey.toString());
      toast({
        title: 'Merkle tree créé',
        description: `Adresse: ${merkleTreeSigner.publicKey.toString()}`,
        status: 'success',
        duration: 7000,
      });
    } catch (e: any) {
      const logs = await extractLogs(e);
      console.error('createTree failed:', e, logs);

      const hint =
        logs?.find((l) => l?.toLowerCase().includes('error')) ||
        logs?.slice(-1)[0] ||
        e?.message;

      toast({
        title: 'Création du Merkle tree a échoué',
        description: hint ?? 'Simulation failed. Check program logs.',
        status: 'error',
        duration: 12000,
      });
    }
  };

  const handleFetchMerkleTree = async () => {
    try {
      const treePk = publicKey(process.env.NEXT_PUBLIC_MERKLETREE as string);
      const treeConfig = await fetchTreeConfigFromSeeds(umi, { merkleTree: treePk });
      const merkleTreeAccount = await fetchMerkleTree(umi, treePk);
      console.log(merkleTreeAccount, ' treeConfig: ', treeConfig);
      toast({
        title: 'Merkle tree chargé',
        description: `Canopy: ${CANOPY} (V1), Depth: ${MAX_DEPTH}`,
        status: 'info',
        duration: 5000,
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Fetch tree a échoué',
        description: e?.message ?? 'Erreur inconnue',
        status: 'error',
        duration: 8000,
      });
    }
  };

  const handleCreateCollection = async () => {
    try {
      const collectionMintSigner = generateSigner(umi);
      await createNft(umi, {
        mint: collectionMintSigner,
        name: "Ticket",
        uri: "https://gateway.irys.xyz/EeMKBNhtBuZpoLjfaKRVc72MEGkNcCgXF7oKMLpzsnhz",
        sellerFeeBasisPoints: percentAmount(5.5), // 5.5%
        isCollection: true,
      }).sendAndConfirm(umi);

      console.log('Your collection: ', collectionMintSigner.publicKey.toString());
      setCollectionMint(collectionMintSigner.publicKey.toString());

      toast({
        title: 'Collection (Token Metadata) créée',
        description: collectionMintSigner.publicKey.toString(),
        status: 'success',
        duration: 7000,
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Création de la collection a échoué',
        description: e?.message ?? 'Erreur inconnue',
        status: 'error',
        duration: 9000,
      });
    }
  };

  // === Mint V1 lié à la collection Token Metadata ===
  const handleMintWithCollection = async () => {
    try {
      if (!process.env.NEXT_PUBLIC_MERKLETREE) {
        throw new Error('NEXT_PUBLIC_MERKLETREE est vide. Crée l’arbre ou définis la variable.');
      }
      if (!process.env.NEXT_PUBLIC_COLLECTION) {
        throw new Error('NEXT_PUBLIC_COLLECTION est vide. Crée la collection ou définis la variable.');
      }

      const merkleTreePk = publicKey(process.env.NEXT_PUBLIC_MERKLETREE as string);
      const collectionMintPk = publicKey(process.env.NEXT_PUBLIC_COLLECTION as string);

      await mintToCollectionV1(umi, {
        leafOwner: umi.identity.publicKey,   // destinataire; remplace par target wallet pour airdrop
        merkleTree: merkleTreePk,
        collectionMint: collectionMintPk,    // TM Collection (V1)
        collectionAuthority: umi.identity,   // doit détenir l’authority de la collection
        metadata: {
          name: 'Nyan Cat',
          symbol: 'NYAN',
          uri: 'ipfs://bafybeibw6kgu3t46zw3bbo7fzr6ipp4g2hfelvelyhvnn6a4a3u4yykdh4/0.json',
          sellerFeeBasisPoints: 0,
          // requis par les typings V1: Collection { key, verified } dans some(...)
          collection: some({ key: collectionMintPk, verified: false }),
          creators: [
            {
              address: umi.identity.publicKey,
              share: 100,
              verified: true,
            }
          ],
        },
      }).sendAndConfirm(umi);

      toast({ title: 'cNFT minté (V1)', status: 'success', duration: 6000 });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Mint V1 échoué',
        description: e?.message ?? 'Erreur inconnue',
        status: 'error',
        duration: 9000,
      });
    }
  };

  const PageContent = () => {
    return (
      <>
        <style jsx global>
          {`
            body {
              background: #2d3748; 
            }
          `}
        </style>

        <div className=" page tw-bg-gray-50">
          <div className="tw-flex  tw-flex-auto">
            <div id="content"
              className="tw-relative tw-flex tw-flex-col tw-flex-auto tw-ml-0 2xl:tw-items-center content__slim">
              <div className="tw-relative tw-h-full " style={{ maxWidth: '1920px' }}>
                <div
                  className="tw-absolute tw-inset-y-0 tw-w-[40px] tw-z-10 tw-pointer-events-none tw-from-gray-50 tw-hidden tw-left-0 tw-bg-gradient-to-r">
                </div>
                <div
                  className="tw-absolute tw-inset-y-0 tw-w-[40px] tw-z-10 tw-pointer-events-none tw-from-gray-50 tw-hidden tw-right-0 tw-bg-gradient-to-l">
                </div>
                <div className="tw-px-4 lg:tw-px-10 2xl:tw-px-0 " style={{maxHeight: '78px'}}>
                  <div className=" tw-text-white-2">
                    <div
                      className="tw-relative tw-pt-4 lg:tw-pt-10 tw-pb-10 lg:tw-pb-20 tw--mx-4 tw-px-4 lg:tw--mx-10 lg:tw-px-10 2xl:tw-mx-0 2xl:tw-px-0">
                      <div className="tw-relative tw-z-20">
                        <div className="tw-space-y-4">
                          <div className="tw-grid tw-grid-cols-12 lg:tw-gap-x-10 2xl:tw-gap-x-4">
                            <div
                              className="tw-col-start-1 tw-col-span-12 2xl:tw-col-start-2 2xl:tw-col-span-10">
                              <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                  <a target="_blank" rel="noreferrer" href="https://www.fiverr.com/ashar_web3/build-solana-compressed-nft-mint-site-bubblegum-v2-cnft-mint">
                                    <button className="wallet-adapter-button wallet-adapter-button-trigger">Order</button>
                                  </a>
                                  <WalletMultiButtonDynamic />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <MyButtonList
          umi={umi}
          isConnected={walletConnected}
          setTxList={setTxList}
        />

        <div className="dcxasx" style={{ display: 'flex', gap: 12 }}>
          <button className="wallet-adapter-button wallet-adapter-button-trigger" onClick={handleCreateTreeV1}>
            createTree V1
          </button>
          <button className="wallet-adapter-button wallet-adapter-button-trigger" onClick={handleFetchMerkleTree}>
            fetch tree
          </button>
          <button className="wallet-adapter-button wallet-adapter-button-trigger" onClick={handleCreateCollection}>
            create collection
          </button>
          <button className="wallet-adapter-button wallet-adapter-button-trigger" onClick={handleMintWithCollection}>
            Mint (V1)
          </button>
        </div>

        <div style={{color: 'white', fontWeight: 'bold', marginTop: 12}}>
          merkle: {merkleTree}
          <br/>
          collection: {collectionMint}
        </div>
      </>
    );
  };

  return (
    <body>
      <main>
        <PageContent key="content" />
      </main>
    </body>
  );
}
