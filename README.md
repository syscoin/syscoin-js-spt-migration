# Syscoin SPT migration from Syscoin 4.1.x to 4.2 UTXO assets (syscoinjs-spt-migration)

Migrating assets to Syscoin 4.2 requires a snapshot of existing assets on Syscoin 4.1.3 using listassets/listassetallocations and sending by some block height (nUTXOAssetsBlockProvisioning in chainparams of Syscoin Core) which will allow us to send a custom asset guid (matching existing 4.1.3 assets) to provision them on a UTXO model. Then we transfer them to the original destination so existing owners retain rights to the asset. The work is idempotent meaning you can start and stop the script and it will pick up where it left off because it checks if existing asset/allocations/transfers have already been done and skip if so.

1) Send SYS to atleast number of assets outputs to provision enough outputs to create assets without waiting for block.
2) Create assets one at a time
3) Issue assets (allocations) to addresses and amounts found in listassetallocations output from 4.1.3
4) Transfer the asset ownership by sending the 0 value UTXO (ownership UTXO asset) to original owner as found in listassets output from 4.1.3

Steps 1/2 done by calling index.js with "createassets", step 3 done by calling index.js with "issueassets" and step4 done by calling index.js with "transferassets". Meant to be run via nodejs but can connect to any blockbook running on Syscoin 4.2

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
