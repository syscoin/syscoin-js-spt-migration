# Syscoin SPT migration from Syscoin 4.1.x to 4.2 UTXO assets (syscoinjs-spt-migration)

Migrating assets to Syscoin 4.2 requires a snapshot of existing assets on Syscoin 4.1.3 using listassets/listassetallocations and sending by some block height (nUTXOAssetsBlockProvisioning in chainparams of Syscoin Core) which will allow us to send a custom asset guid (matching existing 4.1.3 assets) to provision them on a UTXO model. Then we transfer them to the original destination so existing owners retain rights to the asset. The work is idempotent meaning you can start and stop the script and it will pick up where it left off because it checks if existing asset/allocations/transfers have already been done and skip if so.

1) Send SYS to atleast number of assets outputs to provision enough outputs to create assets without waiting for block.
2) Create assets one at a time
3) Issue assets (allocations) to addresses and amounts found in listassetallocations output from 4.1.3. This is done in parallel across assets, and one transaction per up to 255 outputs is sent to the network.
4) Transfer the asset ownership by sending the 0 value UTXO (ownership UTXO asset) to original owner as found in listassets output from 4.1.3

Steps 1/2 done by calling index.js with "createassets", step 3 done by calling index.js with "issueassets" and step4 done by calling index.js with "transferassets". Meant to be run via nodejs but can connect to any blockbook running on Syscoin 4.2


Here is what it looks like running on testnet snapshot:

Create Assets:

```
node index.js createassets
Account XPUB: vpub5YFruvJNbcL3XbL9nYaFBs6yKxLjHySCMNLYTT5sCdua78L96jGZYjShjLtrc6QmsUq2Hpk6XY29UYCSMbRaFAXfabNCxnRgwsnCTEEN8Mk
Allocating SYS to 255 outputs...
tx successfully sent! txid: a56660d0402e270557ad2b6cf2654ddd5be55b0ae2dbe20ba3669c7d4e6e7969
Waiting for confirmation for: a56660d0402e270557ad2b6cf2654ddd5be55b0ae2dbe20ba3669c7d4e6e7969
Confirmed, we are now ready up to 255 assets!
Reading assets.json file...
Read 40 assets...
tx successfully sent! txid: 3619fa796625b03a3350ab35f26207310a014a61609eb37029df4807b9ccf167
tx successfully sent! txid: c86fc379d689025dc5d262c80f8da59cce9a74cb63ffcf0338d495d0a31811a5
tx successfully sent! txid: 1c242424879e9861bf33bffec22ed1a01923fc83da12c7f43b69e909cc52cd9d
...
Confirming last tx: 371a82a4ad7b5a28c35ad0db76a9069bad15fe18e19ad9f6d63402d0736cacfb. Total assets so far: 40. Remaining assets: 0
Done, created 40 assets!
```

Issue Assets:

```
node index.js issueassets
Account XPUB: vpub5YFruvJNbcL3XbL9nYaFBs6yKxLjHySCMNLYTT5sCdua78L96jGZYjShjLtrc6QmsUq2Hpk6XY29UYCSMbRaFAXfabNCxnRgwsnCTEEN8Mk
Reading assetallocations.json file...
Issuing asset allocations...
Sending 2 allocations for asset 179280939
optimizeFees: reducing fees by: 1000
tx successfully sent! txid: b0efd968c85972463b87a9ca9694c09aa044274f47616adaab59d9e923c6ef84
Confirming last tx: b0efd968c85972463b87a9ca9694c09aa044274f47616adaab59d9e923c6ef84. Asset 179280939 Total asset allocations so far: 2. Remaining allocations: 0
Sending 1 allocations for asset 165916674
optimizeFees: reducing fees by: 1000
tx successfully sent! txid: de70982b59ac6ddb6e4adb538492cbb46c55491af690f5523dcb6b19ab34f6d8
...
Confirming last tx: de70982b59ac6ddb6e4adb538492cbb46c55491af690f5523dcb6b19ab34f6d8. Asset 165916674
Done, issued allocations for 16 assets!
```

Transfer Assets:

```
node index.js transferassets
Account XPUB: vpub5YFruvJNbcL3XbL9nYaFBs6yKxLjHySCMNLYTT5sCdua78L96jGZYjShjLtrc6QmsUq2Hpk6XY29UYCSMbRaFAXfabNCxnRgwsnCTEEN8Mk
Reading assets.json file...
Read 40 assets...
tx successfully sent! txid: b4076f029028a6df9f1de4b545cf20251ab5e41bbdcb23ceb41855eb74ed4ad4
tx successfully sent! txid: 078ba1f16a44a86d794465e76e8bb12ad70706115583ae062d198ff4b593a793
...
Confirming last tx: a46e770aa12500dd35d75c3e56ae06aab1a91542ed50eeafef1da7a9047e8a23. Total assets so far: 40.
Done, transferred 40 assets!
```

Released under the terms of the [MIT LICENSE](LICENSE).

## Complementing Libraries
- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) - A javascript Bitcoin library for node.js and browsers. Configurable with Syscoin network settings to work with Syscoin addresses and message signing.
- [BIP84](https://github.com/Anderson-Juhasc/bip84) - P2WPKH/P2WSH HD wallet derivation library for BECH32 addresses
- [syscointx-js](https://github.com/syscoin/syscointx-js) - A raw transaction creation library using coinselectsyscoin for input selection.
- [syscoinjs-lib](https://github.com/syscoin/syscoinjs-lib) - High level SDK library for Syscoin in Javascript.
- [coinselectsyscoin](https://github.com/syscoin/coinselectsyscoin) - A fee-optimizing, transaction input selection module for syscoinjs-tx.
- [crypto-js](https://github.com/brix/crypto-js) - JavaScript library of crypto standards. Used for AES Encrypt/Decrypt of sensitive HD wallet info to local storage.
- [axios](https://github.com/axios/axios) - Promise based HTTP client for the browser and node.js. Used for backend communication with a Blockbook API as well as notary endpoints where applicable.





## LICENSE [MIT](LICENSE)
