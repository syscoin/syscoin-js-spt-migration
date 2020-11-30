const sjs = require('syscoinjs-lib')
const sjstx = require('syscointx-js')
const mnemonic = 'click peace basic main rough judge spice dentist reason rookie lunar village rib venue figure'
// blockbook URL
const backendURL = 'http://localhost:19035' // if using localhost you don't need SSL see use 'systemctl edit --full blockbook-syscoin.service' to remove SSL from blockbook
// 'null' for no password encryption for local storage and 'true' for testnet
const HDSigner = new sjs.utils.HDSigner(mnemonic, null, true)
const syscoinjs = new sjs.SyscoinJSLib(HDSigner, backendURL)
const whitelist = []
const NUMOUTPUTS_TX = 255
const assetCostWithFee = new sjs.utils.BN(151).mul(new sjs.utils.BN(sjstx.utils.COIN))
const maxAsset = new sjs.utils.BN('999999999999999999')
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
  const assetallocations = require('./allocations.json')
  const assetallocationsMap = new Map()
  // group allocations via guid as keys in a map
  for (let i = 0; i < assetallocations.length; i++) {
    const allocation = assetallocations[i]
    if (allocation.address === 'burn') {
      continue
    }
    allocation.balance = String(allocation.balance).replace('.', '')
    if (assetallocationsMap.has(allocation.asset_guid)) {
      const allocations = assetallocationsMap.get(allocation.asset_guid)
      allocations.push(allocation)
    } else {
      assetallocationsMap.set(allocation.asset_guid, [allocation])
    }
  }
  for (const key of assetallocationsMap.keys()) {
    const assetAllocation = whitelist.find(voutAsset => voutAsset.asset_guid === key)
    if (whitelist.length > 0 && assetAllocation === undefined) {
      assetallocationsMap.delete(key)
    }
  }
  return assetallocationsMap
}
async function confirmAssetAllocation (address, assetGuid, balance) {
  const utxoObj = await sjs.utils.fetchBackendUTXOS(syscoinjs.blockbookURL, address)
  if (utxoObj.utxos) {
    for (let i = 0; i < utxoObj.utxos.length; i++) {
      const utxo = utxoObj.utxos[i]
      if (utxo.assetInfo) {
        if (utxo.assetInfo.assetGuid === assetGuid && new sjs.utils.BN(utxo.assetInfo.value).eq(balance)) {
          return true
        }
      }
    }
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
async function confirmAsset (assetGuid, address) {
  if (!address) {
    // either asset has confirmed or its in mempool as seen by utxo query
    const asset = await sjs.utils.fetchBackendAsset(syscoinjs.blockbookURL, assetGuid)
    if (asset && asset.assetGuid === assetGuid) {
      return true
    }
  }
  const utxoObj = await sjs.utils.fetchBackendUTXOS(syscoinjs.blockbookURL, address || HDSigner.getAccountXpub())
  if (utxoObj.assets) {
    for (let i = 0; i < utxoObj.assets.length; i++) {
      const assetObj = utxoObj.assets[i]
      if (assetObj.assetGuid === assetGuid) {
        return true
      }
    }
  }

  return false
}
async function confirmTx (txid) {
  for (let i = 0; i < 300; i++) {
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
    asset.asset_guid = Math.floor(asset.asset_guid / 5) // HACK for now
    const assetExists = await confirmAsset(asset.asset_guid)
    if (!assetExists) {
      count++
      const txOpts = { rbf: false, assetGuid: asset.asset_guid }
      let pubdata
      try {
        pubdata = JSON.parse(asset.public_value).description
      } catch (e) {
        pubdata = asset.public_value
      }
      // int64 limits
      // largest decimal amount that we can use, without compression overflow of uint (~1 quintillion satoshis)
      // 10^18 - 1 (999999999999999999)
      // use limit if supply was negative meaning max supply
      asset.max_supply = asset.max_supply.replace('.', '')
      let maxSupplyBN = new sjs.utils.BN(asset.max_supply)
      if (maxSupplyBN.isNeg() || maxSupplyBN.gt(maxAsset)) {
        maxSupplyBN = maxAsset
      }
      const assetOpts = { precision: asset.precision, symbol: asset.symbol, maxsupply: maxSupplyBN, description: pubdata.slice(0, 128) }
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
        // setup next round of NUMOUTPUTS_TX outputs for asset funding
        const sendRes = await sendSys()
        if (!sendRes) {
          return
        }
      }
      await sleep(1500)
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
  } else {
    console.log('Done, nothing to do...')
  }
}
async function issueAssetAllocation (key, values, assetCount) {
  // sleep to allow for one transaction to process at one time in the Promise.All call
  await sleep(assetCount * 1500)
  const assetGuid = Math.floor(key / 5) // HACK for now
  console.log('Sending ' + values.length + ' allocations for asset ' + assetGuid)
  const valueLenCopy = values.length
  let allocationOutputs = []
  let totalOutputCount = 0
  while (values.length > 0) {
    const value = values.pop()
    const balanceBN = new sjs.utils.BN(value.balance)
    const assetAllocationExists = await confirmAssetAllocation(value.address, assetGuid, balanceBN)
    if (!assetAllocationExists) {
      allocationOutputs.push({ value: balanceBN, address: value.address })
      // group outputs of an asset into up to NUMOUTPUTS_TX outputs per transaction
      if (allocationOutputs.length >= NUMOUTPUTS_TX) {
        totalOutputCount += allocationOutputs.length
        const assetMap = new Map([
          [assetGuid, { outputs: allocationOutputs }]
        ])
        const res = await issueAsset(assetMap)
        if (!res) {
          console.log('Could not issue asset tx for guid ' + assetGuid + ', retrying...')
          continue
        }
        console.log('Confirming tx: ' + res.txid + '. Total asset allocations so far: ' + totalOutputCount + '. Remaining allocations: ' + values.length)
        const confirmed = await confirmTx(res.txid)
        if (!confirmed) {
          console.log('Could not issue asset, transaction not confirmed, exiting...')
          return
        }
        await sleep(1500)
        allocationOutputs = []
      }
    } else {
      totalOutputCount++
    }
  }
  if (allocationOutputs.length > 0) {
    totalOutputCount += allocationOutputs.length
    const assetMap = new Map([
      [assetGuid, { outputs: allocationOutputs }]
    ])
    const res = await issueAsset(assetMap)
    if (!res) {
      console.log('Could not issue last asset tx, exiting...')
      return
    }
    console.log('Confirming last tx: ' + res.txid + '. Asset ' + assetGuid + ' Total asset allocations so far: ' + totalOutputCount + '. Remaining allocations: ' + values.length)
    const confirmed = await confirmTx(res.txid)
    if (!confirmed) {
      console.log('Could not issue asset, transaction not confirmed, exiting...')
      return
    }
  }
  console.log('Done sending ' + valueLenCopy + ' allocations for asset ' + assetGuid)
}
async function issueAssets () {
  const assetallocations = readAssetAllocations()
  console.log('Issuing asset allocations...')
  let assetCount = 0
  let promises = []
  const asyncAssets = 10
  for (const [key, values] of assetallocations.entries()) {
    assetCount++
    promises.push(issueAssetAllocation(key, values, assetCount))
    if ((assetCount % asyncAssets) === 0) {
      await Promise.all(promises)
      promises = []
    }
  }
  if (promises.length > 0) {
    await Promise.all(promises)
  }
  if (assetCount > 0) {
    console.log('Done, issued allocations for ' + assetCount + ' assets!')
  }
}
async function transferAssets () {
  const assets = readAssets()
  console.log('Read ' + assets.length + ' assets...')
  let res
  let count = 0
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    asset.asset_guid = Math.floor(asset.asset_guid / 5) // HACK for now
    const assetTransferred = await confirmAsset(asset.asset_guid, asset.address)
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
      await sleep(1500)
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
  const assetMap = new Map([
    [assetGuid, { outputs: [{ value: new sjs.utils.BN(0), address: address }] }]
  ])
  // let HDSigner find change address
  const sysChangeAddress = null
  const psbt = await syscoinjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate)
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
  const utxoObj = await sjs.utils.fetchBackendUTXOS(syscoinjs.blockbookURL, HDSigner.getAccountXpub())
  let count = 0
  if (utxoObj.utxos.length >= NUMOUTPUTS_TX) {
    for (let i = 0; i < utxoObj.utxos.length; i++) {
      const utxo = utxoObj.utxos[i]
      if (utxo.confirmations <= 0) {
        continue
      }
      const utxoBNVal = new sjs.utils.BN(utxo.value)
      if (utxoBNVal.gte(assetCostWithFee)) {
        count++
        if (count > NUMOUTPUTS_TX) {
          break
        }
      }
    }
    if (count >= NUMOUTPUTS_TX) {
      console.log('There are already ' + count + ' UTXOs to fund new assets in this account, proceeding with creating assets!')
      return true
    }
  }
  console.log('Allocating SYS to ' + (NUMOUTPUTS_TX - count) + ' outputs...')
  const feeRate = new sjs.utils.BN(10)
  const txOpts = { rbf: false }
  // let HDSigner find change address
  const sysChangeAddress = null
  const outputsArr = []
  // send assetCostWithFee amount to NUMOUTPUTS_TX outputs so we can respend NUMOUTPUTS_TX times in a block for asset transactions (new,update,issue assets)
  for (let i = 0; i < (NUMOUTPUTS_TX - count); i++) {
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
    return false
  } else if (resSend.result) {
    console.log('tx successfully sent! txid: ' + resSend.result)
  } else {
    console.log('Unrecognized response from backend: ' + resSend)
    return false
  }
  console.log('Waiting for confirmation for: ' + resSend.result)
  const confirmed = await confirmTx(resSend.result)
  if (!confirmed) {
    console.log('Could not send SYS, transaction not confirmed, exiting...')
    return false
  }
  console.log('Confirmed, we are now ready up to ' + NUMOUTPUTS_TX + ' assets!')
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
    await sleep(1500)
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
