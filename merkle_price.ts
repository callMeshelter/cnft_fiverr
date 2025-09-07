#!/usr/bin/env -S node
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getConcurrentMerkleTreeAccountSize } from "@solana/spl-account-compression";

// parse très simple sans lib
function getArg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const rpc =
  getArg("--rpc") ||
  process.env.SOLANA_RPC ||
  process.env.NEXT_PUBLIC_SOLANA_RPC ||
  "https://api.mainnet-beta.solana.com";

const depth  = parseInt(getArg("--depth",  "20")!, 10);
const buffer = parseInt(getArg("--buffer", "64")!, 10);
const canopy = parseInt(getArg("--canopy", "0")!, 10);

async function main() {
  const conn = new Connection(rpc, "confirmed");
  const bytes = getConcurrentMerkleTreeAccountSize(depth, buffer, canopy);
  const lamports = await conn.getMinimumBalanceForRentExemption(bytes);
  const sol = lamports / LAMPORTS_PER_SOL;

  console.log("RPC        :", rpc);
  console.log("Parameters :", { depth, buffer, canopy });
  console.log("AccountSize:", `${bytes} bytes`);
  console.log("Rent (SOL) :", sol.toFixed(6));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
