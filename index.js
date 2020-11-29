const sjs = require('syscoinjs-lib')
const sjstx = require('syscointx-js')
const mnemonic = 'dizzy correct machine junior amateur left evil chase crush position smooth deposit today eternal voyage'
// blockbook URL
const backendURL = 'http://localhost:19035' // if using localhost you don't need SSL see use 'systemctl edit --full blockbook-syscoin.service' to remove SSL from blockbook
// 'null' for no password encryption for local storage and 'true' for testnet
const HDSigner = new sjs.utils.HDSigner(mnemonic, null, true)
const syscoinjs = new sjs.SyscoinJSLib(HDSigner, backendURL)
const whitelist = []
const NUMOUTPUTS_TX = 255
const assetCostWithFee = new sjs.utils.BN(151).mul(new sjs.utils.BN(sjstx.utils.COIN))
function readAssets () {
  console.log('Reading assets.json file...')
  const assets = require('./assets.json')
  let assetsToReturn = []
  if (whitelist.length > 0) {
    for (let i = 0; i < assets.length; i++) {
      const assetAllocation = whitelist.find(voutAsset => voutAsset.asset_guid === assets[i].asset_guid)
      if (assetAllocation !== undefined) {
        assetsToReturn.push(assets[i])
      }
    }
  } else {
    assetsToReturn = assets
  }
  return assetsToReturn
}
function readAssetAllocations () {
  console.log('Reading assetallocations.json file...')
  const assetallocations = require('./assetallocations.json')
  const assetallocationsMap = new Map()
  let totalCount = 0
  // group allocations via guid as keys in a map
  for (let i = 0; i < assetallocations.length; i++) {
    const allocation = assetallocations[i]
    if (assetallocationsMap.has(allocation.asset_guid)) {
      const allocations = assetallocationsMap.get(allocation.asset_guid)
      allocations.push(allocation)
    } else {
      assetallocationsMap.set(allocation.asset_guid, [allocation])
    }
  }
  for (const [key, value] of Object.entries(assetallocationsMap)) {
    const assetAllocation = whitelist.find(voutAsset => voutAsset.asset_guid === key)
    if (whitelist.length > 0 && assetAllocation === undefined) {
      assetallocationsMap.delete(key)
    } else {
      totalCount += value.length
    }
  }
  return { map: assetallocationsMap, count: totalCount }
}
async function confirmAssetAllocation (address, assetGuid, balance) {
  const utxoObj = await sjs.utils.fetchBackendUTXOS(syscoinjs.blockbookURL, address)
  if (utxoObj.utxos) {
    utxoObj.utxos.forEach(utxo => {
      if (utxo.assetInfo) {
        if (utxo.address === address && utxo.assetInfo.assetGuid === assetGuid && new sjs.utils.BN(utxo.assetInfo.value).eq(balance)) {
          return true
        }
      }
    })
  }
  return false
}
async function confirmAccount () {
  const utxoObj = await sjs.utils.fetchBackendAccount(syscoinjs.blockbookURL, HDSigner.getAccountXpub(), null, true)
  return (utxoObj.balance && utxoObj.balance !== '0')
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
async function confirmAsset (assetGuid) {
  const asset = await sjs.utils.fetchBackendAsset(backendURL, assetGuid)
  return (asset && asset.assetGuid === assetGuid)
}
async function confirmAssetTransferred (assetGuid, address) {
  const utxoObj = await sjs.utils.fetchBackendUTXOS(syscoinjs.blockbookURL, address)
  if (utxoObj.assets) {
    utxoObj.assets.forEach(asset => {
      if (asset.assetGuid === assetGuid) {
        return true
      }
    })
  }
  return false
}
async function confirmTx (txid) {
  for (let i = 0; i < 100; i++) {
    await sleep(1000)
    const tx = await sjs.utils.fetchBackendRawTx(backendURL, txid)
    if (tx.confirmations && tx.confirmations > 0) {
      return true
    }
  }
  console.log('Could not find a confirmed transaction for txid ' + txid)
  return false
}
async function createAssets () {
  const assets = readAssets()
  console.log('Read ' + assets.length + ' assets...')
  let res
  let count = 0
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    const assetExists = await confirmAsset(asset.asset_guid)
    if (!assetExists) {
      count++
      const txOpts = { rbf: false, assetGuid: asset.asset_guid }
      const currentPubDataJson = JSON.parse(asset.public_value)
      const pubdata = (currentPubDataJson && currentPubDataJson.description) || asset.public_value
      // int64 limits
      // largest decimal amount that we can use, without compression overflow of uint (~1 quintillion satoshis)
      // 10^18 - 1 (999999999999999999)
      // use limit if supply was negative meaning max supply
      const maxsupply = (asset.max_supply < 0 ||  asset.max_supply > 999999999999999999)? new sjs.utils.BN('999999999999999999') : new sjs.utils.BN(asset.max_supply).mul(new sjs.utils.BN(sjstx.utils.COIN))
      const assetOpts = { precision: asset.precision, symbol: asset.symbol, maxsupply: maxsupply, description: pubdata.slice(0, 128) }
      res = await newAsset(assetOpts, txOpts)
      if (!res) {
        console.log('Could not create assets, transaction not confirmed, exiting...')
        return
      }
      if ((count % NUMOUTPUTS_TX) === 0) {
        console.log('Confirming tx: ' + res.txid + '. Total assets so far: ' + count + '. Remaining assets: ' + (assets.length - count))
        const confirmed = await confirmTx(res.txid)
        if (!confirmed) {
          console.log('Could not create assets, transaction not confirmed, exiting...')
          return
        }
        res = null
      }
    }
  }
  if ((count % NUMOUTPUTS_TX) !== 0 && res) {
    console.log('Confirming last tx: ' + res.txid + '. Total assets so far: ' + count + '. Remaining assets: ' + (assets.length - count))
    const confirmed = await confirmTx(res.txid)
    if (!confirmed) {
      console.log('Could not create assets, transaction not confirmed, exiting...')
      return
    }
  }
  if (count > 0) {
    console.log('Done, created ' + count + ' assets!')
  }
}
async function issueAssets () {
  const assetallocations = readAssetAllocations()
  console.log('Issuing asset allocations...')
  let currentOutputCount = 0
  let totalOutputCount = 0
  for (const [key, values] of Object.entries(assetallocations.map)) {
    const assetGuid = key
    let allocationOutputs = []
    while (values.length > 0) {
      const value = values.pop()
      const assetAllocationExists = await confirmAssetAllocation(value.address, assetGuid, value.balance)
      if (!assetAllocationExists) {
        allocationOutputs.push({ value: value.balance, address: value.address })
        // group outputs of an asset into up to NUMOUTPUTS_TX outputs per transaction
        if (allocationOutputs.length >= NUMOUTPUTS_TX) {
          currentOutputCount += allocationOutputs.length
          totalOutputCount += allocationOutputs.length
          const assetMap = new Map([
            [assetGuid, { outputs: allocationOutputs }]
          ])
          const res = await issueAsset(assetMap)
          if (!res) {
            console.log('Could not issue asset tx, exiting...')
            return
          }
          // every 3000 outputs we wait for a new block
          if (currentOutputCount >= 3000) {
            currentOutputCount = 0
            console.log('Confirming tx: ' + res.txid + '. Total asset allocations so far: ' + totalOutputCount + '. Remaining allocations: ' + (assetallocations.count - totalOutputCount))
            const confirmed = await confirmTx(res.txid)
            if (!confirmed) {
              console.log('Could not issue asset, transaction not confirmed, exiting...')
              return
            }
          }
          allocationOutputs = []
        }
      }
    }
    if (allocationOutputs.length > 0) {
      const assetMap = new Map([
        [assetGuid, { outputs: allocationOutputs }]
      ])
      const res = await issueAsset(assetMap)
      if (!res) {
        console.log('Could not issue last asset tx, exiting...')
        return
      }
      console.log('Confirming last tx: ' + res.txid + '. Total asset allocations so far: ' + totalOutputCount + '. Remaining allocations: ' + (assetallocations.count - totalOutputCount))
      const confirmed = await confirmTx(res.txid)
      if (!confirmed) {
        console.log('Could not issue asset, transaction not confirmed, exiting...')
        return
      }
    }
  }
  if (totalOutputCount > 0) {
    console.log('Done, issued ' + totalOutputCount + ' asset allocations!')
  }
}
async function transferAssets () {
  const assets = readAssets()
  console.log('Read ' + assets.length + ' assets...')
  let res
  let count = 0
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    const assetTransferred = await confirmAssetTransferred(asset.asset_guid, asset.address)
    if (!assetTransferred) {
      count++
      res = await transferAsset(asset.asset_guid, asset.address)
      if (!res) {
        console.log('Could not transfer asset, exiting...')
        return
      }
      if ((count % NUMOUTPUTS_TX) === 0) {
        console.log('Confirming tx: ' + res.txid + '. Total assets so far: ' + count + '. Remaining assets: ' + (assets.length - count))
        const confirmed = await confirmTx(res.txid)
        if (!confirmed) {
          console.log('Could not transfer asset, transaction not confirmed, exiting...')
          return
        }
      }
      res = null
    }
  }
  if ((count % NUMOUTPUTS_TX) !== 0 && res) {
    console.log('Confirming last tx: ' + res.txid + '. Total assets so far: ' + count + '. Remaining assets: ' + (assets.length - count))
    const confirmed = await confirmTx(res.txid)
    if (!confirmed) {
      console.log('Could not transfer asset, transaction not confirmed, exiting...')
      return
    }
  }
  if (count > 0) {
    console.log('Done, transferred ' + count + ' assets!')
  }
}

async function newAsset (assetOpts, txOpts) {
  const feeRate = new sjs.utils.BN(10)
  // let HDSigner find change address
  const sysChangeAddress = null
  // let HDSigner find asset destination address
  const sysReceivingAddress = null
  const psbt = await syscoinjs.assetNew(assetOpts, txOpts, sysChangeAddress, sysReceivingAddress, feeRate)
  if (!psbt) {
    console.log('Could not create transaction, not enough funds?')
    return null
  }
  // example of once you have it signed you can push it to network via backend provider
  const resSend = await sjs.utils.sendRawTransaction(syscoinjs.blockbookURL, psbt.extractTransaction().toHex(), HDSigner)
  if (resSend.error) {
    console.log('could not send tx! error: ' + resSend.error.message)
    return null
  } else if (resSend.result) {
    console.log('tx successfully sent! txid: ' + resSend.result)
  } else {
    console.log('Unrecognized response from backend: ' + resSend)
    return null
  }
  return { txid: resSend.result }
}

async function transferAsset (assetGuid, address) {
  const feeRate = new sjs.utils.BN(10)
  const txOpts = { rbf: true }
  const assetOpts = { }
  const psbt = await syscoinjs.assetUpdate(assetGuid, assetOpts, txOpts, address, feeRate)
  if (!psbt) {
    console.log('Could not create transaction, not enough funds?')
    return null
  }
  // example of once you have it signed you can push it to network via backend provider
  const resSend = await sjs.utils.sendRawTransaction(syscoinjs.blockbookURL, psbt.extractTransaction().toHex(), HDSigner)
  if (resSend.error) {
    console.log('could not send tx! error: ' + resSend.error.message)
    return null
  } else if (resSend.result) {
    console.log('tx successfully sent! txid: ' + resSend.result)
  } else {
    console.log('Unrecognized response from backend: ' + resSend)
    return null
  }
  return { txid: resSend.result }
}

async function issueAsset (assetMap) {
  const feeRate = new sjs.utils.BN(10)
  const txOpts = { rbf: true }
  // let HDSigner find change address
  const sysChangeAddress = null
  const psbt = await syscoinjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate)
  if (!psbt) {
    console.log('Could not create transaction, not enough funds?')
    return null
  }
  // example of once you have it signed you can push it to network via backend provider
  const resSend = await sjs.utils.sendRawTransaction(syscoinjs.blockbookURL, psbt.extractTransaction().toHex(), HDSigner)
  if (resSend.error) {
    console.log('could not send tx! error: ' + resSend.error.message)
    return null
  } else if (resSend.result) {
    console.log('tx successfully sent! txid: ' + resSend.result)
  } else {
    console.log('Unrecognized response from backend: ' + resSend)
    return null
  }
  return { txid: resSend.result }
}

async function sendSys () {
  const utxoObj = await sjs.utils.fetchBackendUTXOS(syscoinjs.blockbookURL, HDSigner.getAccountXpub(), 'confirmed=true')
  if (utxoObj.utxos.length >= NUMOUTPUTS_TX) {
    let count = 0
    for (let i = 0; i < utxoObj.utxos.length; i++) {
      const utxoBNVal = new sjs.utils.BN(utxoObj.utxos[i].value)
      if (utxoBNVal.gte(assetCostWithFee)) {
        count++
        if (count > NUMOUTPUTS_TX) {
          break
        }
      }
    }
    if (count > NUMOUTPUTS_TX) {
      console.log('There are already ' + count + ' UTXOs to fund new assets in this account, proceeding with creating assets!')
      return true
    }
  }
  console.log('Allocating SYS to ' + NUMOUTPUTS_TX + ' outputs...')
  const feeRate = new sjs.utils.BN(10)
  const txOpts = { rbf: false }
  // let HDSigner find change address
  const sysChangeAddress = null
  const outputsArr = []
  // send assetCostWithFee amount to NUMOUTPUTS_TX outputs so we can respend NUMOUTPUTS_TX times in a block for asset transactions (new,update,issue assets)
  for (let i = 0; i < NUMOUTPUTS_TX; i++) {
    outputsArr.push({ address: await HDSigner.getNewReceivingAddress(), value: assetCostWithFee })
  }
  const psbt = await syscoinjs.createTransaction(txOpts, sysChangeAddress, outputsArr, feeRate)
  if (!psbt) {
    console.log('Could not create transaction, not enough funds?')
    return false
  }
  // example of once you have it signed you can push it to network via backend provider
  const resSend = await sjs.utils.sendRawTransaction(syscoinjs.blockbookURL, psbt.extractTransaction().toHex(), HDSigner)
  if (resSend.error) {
    console.log('could not send tx! error: ' + resSend.error.message)
  } else if (resSend.result) {
    console.log('tx successfully sent! txid: ' + resSend.result)
  } else {
    console.log('Unrecognized response from backend: ' + resSend)
  }
  console.log('Waiting for confirmation for: ' + resSend.result)
  const confirmed = await confirmTx(resSend.result)
  if (!confirmed) {
    console.log('Could not send SYS, transaction not confirmed, exiting...')
    return false
  }
  console.log('Confirmed, we are now ready to create up to ' + NUMOUTPUTS_TX + ' assets per block!')
  return true
}

async function main () {
  console.log('Account XPUB: ' + HDSigner.getAccountXpub())
  const doesAccountExist = await confirmAccount()
  if (!doesAccountExist) {
    console.log('Invalid account specified to HDSigner, no UTXOs present...')
    return
  }
  if (process.argv.length < 3) {
    console.log('usage createassets/issueassets/transferassets')
    return
  }
  if (process.argv[2] === 'createassets') {
    const sendSysRes = await sendSys()
    if (sendSysRes) {
      await createAssets()
    }
  } else if (process.argv[2] === 'issueassets') {
    await issueAssets()
  } else if (process.argv[2] === 'transferassets') {
    await transferAssets()
  } else {
    console.log('Unknown command: valid options are createassets/issueassets/transferassets')
  }
}

main()
