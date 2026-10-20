import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

export function buildSiwsMessage(wallet: string, nonce: string, issuedAt: string): string {
  return `Sign in to Meme Guard\n\nWallet: ${wallet}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function verifySiws(wallet: string, message: string, signature: string): boolean {
  try {
    const pubkey = bs58.decode(wallet);
    const sig = decodeSig(signature);
    const msg = new TextEncoder().encode(message);
    if (pubkey.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(msg, sig, pubkey);
  } catch {
    return false;
  }
}

function decodeSig(signature: string): Uint8Array {
  try {
    return bs58.decode(signature);
  } catch {
    return Uint8Array.from(Buffer.from(signature, "base64"));
  }
}

export function looksLikeWallet(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
