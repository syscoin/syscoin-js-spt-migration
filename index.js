const sjs = require('syscoinjs-lib')
const sjstx = require('syscointx-js')
const mnemonic = 'club toss element melody skin ship rifle student reason real interest insane elevator beauty movie'
// blockbook URL
const backendURL = 'http://localhost:9130'
// 'null' for no password encryption for local storage and 'true' for testnet
const HDSigner = new sjs.utils.HDSigner(mnemonic, null, true)
const syscoinjs = new sjs.SyscoinJSLib(HDSigner, backendURL)
const whitelist = []

function readAssets() {
  console.log("Reading assets.json file...")
  const assets = require('assets.json')
  var assetsToReturn = []
  if(whitelist.length > 0) {
    for (var i = 0; i < assets.length; i++) {
      const assetAllocation = whitelist.find(voutAsset => voutAsset.asset_guid === assets[i].asset_guid)
      if (assetAllocation !== undefined) {
        assetsToReturn.push_back(assets[i])
      }
    }
  } else {
    assetsToReturn = assets
  }
  return assetsToReturn
}
function readAssetAllocations() {
  console.log("Reading assetallocations.json file...")
  const assetallocations = require('assetallocations.json')
  var assetallocationsMap = new Map()
  var totalCount = 0
  // group allocations via guid as keys in a map
  for (var i = 0; i < assetallocations.length; i++) {
    var allocation = assetallocations[i]
    if(assetallocationsMap.has(allocation.asset_guid)) {
      var allocations = assetallocationsMap.get(allocation.asset_guid)
      allocations.push_back(allocation)
    } else {
      assetallocationsMap.set(allocation.asset_guid, [allocation])
    }
  }
  for (const [key, value] of Object.entries(assetallocationsMap)) {
    const assetAllocation = whitelist.find(voutAsset => voutAsset.asset_guid === key)
    if (whitelist.length > 0 && assetAllocation === undefined ) {
      assetallocationsMap.delete(key)
    } else {
      totalCount += value.length
    }
  }
  return {map: assetallocationsMap, count: totalCount}
}
async function confirmAssetAllocation(address, assetGuid, balance) {
  const utxoObj = await syscoinjs.utils.utils.fetchBackendUTXOS(blockbookURL, address)
  if (utxoObj.utxos) {
    utxoObj.utxos.forEach(utxo => {
      if (utxo.assetInfo) {
        if(utxo.address === address && utxo.assetInfo.assetGuid ===  assetGuid && new BN(utxo.assetInfo.value).eq(balance)) {
          return true
        }
      }
    })
  }
  return false
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
async function confirmAsset(assetGuid) {
  const asset = await syscoinjs.utils.fetchBackendAsset(backendURL, assetGuid)
  return (asset && asset.assetGuid === assetGuid)
}
async function confirmTx(txid) {
  for(var i =0;i<100;i++){
    await sleep(1000)
    const tx = await syscoinjs.utils.fetchBackendRawTx(backendURL, txid)
    if(tx.confirmations && tx.confirmations > 0) {
      return true
    }
  }
  console.log('Could not find a confirmed transaction for txid ' + txid)
  return false
}
async function createAssets() {
  var assets = readAssets()
  console.log('Creating assets...')
  var res
  var count = 0
  for (var i = 0; i < assets.length; i++) {
    var asset = assets[i]
    if(!confirmAsset(asset.asset_guid)) {
      count++
      const txOpts = { rbf: false, assetGuid: asset.asset_guid }
      const assetOpts = { precision: asset.precision, symbol: asset.symbol, maxsupply: new syscoinjs.utils.BN(asset.max_supply).mul(sjstx.utils.COIN), description: asset.public_value }
      res = await newAsset(assetOpts, txOpts)
      if(!res) {
        console.log('Could not create assets, transaction not confirmed, exiting...')
        return
      }
      if((count%10) === 0) {
        console.log('Confirming tx: ' + res.txid + '. Total assets so far: ' + (i+1) + '. Remaining assets: ' + (assets.length - (i+1)))
        const confirmed = await confirmTx(res.txid)
        if(!confirmed) {
          console.log('Could not create assets, transaction not confirmed, exiting...')
          return
        }
        res = null
      }
    }
  }
  if((count%10) !== 0 && res) {
    console.log('Confirming last tx: ' + res.txid + '. Total assets so far: ' + (i+1) + '. Remaining assets: ' + (assets.length - (i+1)))
    const confirmed = await confirmTx(res.txid)
    if(!confirmed) {
      console.log('Could not create assets, transaction not confirmed, exiting...')
      return
    }
  }
  console.log('Done, created ' + assets.length + ' assets!')
}
async function issueAssets() {
  var assetallocations = readAssetAllocations()
  console.log('Issuing asset allocations...')
  var currentOutputCount = 0
  var totalOutputCount = 0
  for (const [key, values] of Object.entries(assetallocations.map)) {
    const assetGuid = key
    var allocationOutputs = []
    while(values.length > 0) {
      var value = values.pop()
      const balance = new syscoinjs.utils.BN(value.balance).mul(sjstx.utils.COIN)
      if(!confirmAssetAllocation(address, assetGuid, balance)) {
        allocationOutputs.push_back({value: balance, address: value.address})
        // group outputs of an asset into up to 255 outputs per transaction
        if(allocationOutputs.length >= 255) {
          currentOutputCount+=allocationOutputs.length
          totalOutputCount+=allocationOutputs.length
          const assetMap = new Map([
            [assetGuid, { outputs: allocationOutputs }]
          ])
          var res = await issueAsset(assetMap)
          if(!res) {
            console.log('Could not issue asset tx, exiting...')
            return
          }
          // every 2000 outputs we wait for a new block
          if(currentOutputCount >= 2000) {
            currentOutputCount = 0
            console.log('Confirming tx: ' + res.txid + '. Total asset allocations so far: ' + totalOutputCount + '. Remaining allocations: ' + (assetallocations.count - totalOutputCount))
            const confirmed = await confirmTx(res.txid)
            if(!confirmed) {
              console.log('Could not issue asset, transaction not confirmed, exiting...')
              return
            }
          }
          allocationOutputs = []
        }
      }
    }
    if(allocationOutputs.length > 0) {
      const assetMap = new Map([
        [assetGuid, { outputs: allocationOutputs }]
      ])
      var res = await issueAsset(assetMap)
      if(!res) {
        console.log('Could not issue last asset tx, exiting...')
        return
      }
      console.log('Confirming last tx: ' + res.txid + '. Total asset allocations so far: ' + totalOutputCount + '. Remaining allocations: ' + (assetallocations.count - totalOutputCount))
      const confirmed = await confirmTx(res.txid)
      if(!confirmed) {
        console.log('Could not issue asset, transaction not confirmed, exiting...')
        return
      }
    }
  }
  console.log('Done, issued ' + assetallocations.count + ' asset allocations!')
}
async function transferAssets() {
  var assets = readAssets()
  console.log('Transfering assets...')
  var res
  var i
  for (i = 0; i < assets.length; i++) {
    var asset = assets[i]
    res = await transferAsset(asset.asset_guid, asset.address)
    if(!res) {
      console.log('Could not transfer asset, exiting...')
      return
    }
    if((i%2000) === 0) {
      console.log('Confirming tx: ' + res.txid + '. Total assets so far: ' + (i+1) + '. Remaining assets: ' + (assets.length - (i+1)))
      const confirmed = await confirmTx(res.txid)
      if(!confirmed) {
        console.log('Could not transfer asset, transaction not confirmed, exiting...')
        return
      }
    }
    res = null
  }
  if((i%2000) !== 0 && res) {
    console.log('Confirming last tx: ' + res.txid + '. Total assets so far: ' + (i+1) + '. Remaining assets: ' + (assets.length - (i+1)))
    const confirmed = await confirmTx(res.txid)
    if(!confirmed) {
      console.log('Could not transfer asset, transaction not confirmed, exiting...')
      return
    }
  }
  console.log('Done, transferred ' + assets.length + ' assets!')
}

async function newAsset (assetOpts, txOpts) {
  const feeRate = new syscoinjs.utils.BN(10)
  // let HDSigner find change address
  const sysChangeAddress = null
  // let HDSigner find asset destination address
  const sysReceivingAddress = null
  const psbt = await syscoinjs.assetNew(assetOpts, txOpts, sysChangeAddress, sysReceivingAddress, feeRate)
  if(!psbt) {
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
    console.log('Unrecognized response from backend')
    return null
  }
  return {txid: resSend.result}
}

async function transferAsset (assetGuid, address) {
  const feeRate = new syscoinjs.utils.BN(10)
  const txOpts = { rbf: true }
  const assetOpts =  { }
  const psbt = await syscoinjs.assetUpdate(assetGuid, assetOpts, txOpts, address, feeRate)
  if(!psbt) {
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
    console.log('Unrecognized response from backend')
    return null
  }
  return {txid: resSend.result}
}

async function issueAsset (assetMap) {
  const feeRate = new syscoinjs.utils.BN(10)
  const txOpts = { rbf: true }
  // let HDSigner find change address
  const sysChangeAddress = null
  const psbt = await syscoinjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate)
  if(!psbt) {
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
    console.log('Unrecognized response from backend')
    return null
  }
  return {txid: resSend.result}
}

