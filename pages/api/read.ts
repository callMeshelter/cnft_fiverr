// pages/api/read-file.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { PublicKey } from '@solana/web3.js'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const filePath = path.join(process.cwd(), 'scrap_solana_address.txt') // root-level file
    const fileContents = fs.readFileSync(filePath, 'utf8')

    // Convert into array of addresses (remove empty lines)
    const addresses = fileContents
      .split(/\r?\n/) // split by newline
      .map(line => line.trim())
      .filter(line => line.length > 0)
    
    const fixedAddresses = [];
        for (let i = 0; i < addresses.length; i++) {
            const address = addresses[i];
        try {
        new PublicKey(address)
        fixedAddresses.push(address)
    } catch (e) {
        console.log(address, ' is not valid');
    }
    }

    res.status(200).json({ addresses: fixedAddresses })


  } catch (error) {
    res.status(500).json({
      error: 'Could not read file',
      details: (error as Error).message,
    })
  }
}
