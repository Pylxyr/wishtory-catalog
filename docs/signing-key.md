# The signing key

The app only trusts data signed with one key. Its public half is pinned inside the app
(`catalog/catalog-public-key.txt` in the Wishtory repository, copied here as `public-key.txt`). The private half
is a text file in PEM form, starting with `-----BEGIN PRIVATE KEY-----`. This repository uses the **same** key
as the Wishtory repository, stored as the Actions secret `CATALOG_SIGNING_KEY`. A secret can be written but never
read back from GitHub, so keep your own copy.

## Back it up

1. Keep the PEM text in your password manager (as a secure note) and on one offline copy, for example a USB stick.
   Never commit it or paste it into an issue or chat.
2. Check that a copy is the right key (needs Node.js; prints `OK` when it matches the pinned key):

```powershell
node -e "const c=require('crypto'),fs=require('fs');const k=c.createPrivateKey(fs.readFileSync(process.argv[1]));const p=c.createPublicKey(k).export({format:'der',type:'spki'}).subarray(-32).toString('base64');console.log(p===fs.readFileSync('public-key.txt','utf8').trim()?'OK':'DIFFERENT KEY')" C:\path\to\key.pem
```

## Replace it (lost, leaked or just old)

The app pins exactly one key, so replacing it is an app update. Until players have it, data signed with the new
key is refused by their app (they keep working with what they have; they just stop receiving updates).

1. Make a new key: `node -e "const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('ed25519');console.log(privateKey.export({type:'pkcs8',format:'pem'}));console.log(publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64'))"`.
   The first block is the new private key (back it up now); the last line is the new public key.
2. In the Wishtory repository put the new public key in `catalog/catalog-public-key.txt` and release a new app.
3. Wait until most players have updated.
4. Replace the `CATALOG_SIGNING_KEY` secret in **both** repositories (Wishtory and wishtory-catalog) and put the
   new public key in this repository's `public-key.txt`.
5. Run both publish workflows again (Actions → the workflow → Run workflow; the Wishtory one with "force").

If the key was leaked, do steps 1 and 2 immediately, and do step 4 as soon as the new app is out.
