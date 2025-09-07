// pages/api/remove.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

const FILE = process.env.SCRAP_FILE_PATH
  || path.join(process.cwd(), 'scrap_solana_address.txt');

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const { address } = req.body || {};
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address required' });
  }

  try {
    const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
    // Normalise EOL, split, trim, enlève les vides
    const lines = raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    // Retire UNE occurrence (pas de doublons normalement)
    const idx = lines.indexOf(address);
    if (idx !== -1) lines.splice(idx, 1);

    // ⚠️ Écrit avec un saut de ligne FINAL garanti
    fs.writeFileSync(FILE, lines.join('\n') + '\n', 'utf8');

    return res.status(200).json({ ok: true, removed: idx !== -1, remaining: lines.length });
  } catch (e) {
    console.error('remove error:', e);
    return res.status(500).json({ error: 'server error' });
  }
}
