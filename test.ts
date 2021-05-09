import path from 'path'
import { expect, assert } from 'chai'
import { Framework } from '@vechain/connex-framework'
import { Driver, SimpleNet, SimpleWallet } from '@vechain/connex-driver'
import { secp256k1, address } from 'thor-devkit'

import { compileContract, getABI } from 'myvetools/dist/utils'
import { Contract } from 'myvetools/dist/contract'
import { getReceipt, decodeEvent } from 'myvetools/dist/connexUtils'
import { soloAccounts } from 'myvetools/dist/builtin'

describe('Test contract A', () => {
	const wallet = new SimpleWallet()
	// Add the private keys generated for Thor solo mode
	soloAccounts.forEach(val => { wallet.import(val) })

	const url = 'http://localhost:8669/'

	let connex: Framework
	let driver: Driver

	before(async () => {
		try {
			driver = await Driver.connect(new SimpleNet(url), wallet)
			connex = new Framework(driver)
		} catch (err) {
			assert.fail('Failed to connect: ' + err)
		}
	})

	after(() => {
		driver.close()
	})

	let receipt: Connex.Thor.Transaction.Receipt
	let txRep: Connex.Vendor.TxResponse
	let callOut: Connex.VM.Output & Connex.Thor.Account.WithDecoded

	it('Test contract A', async () => {
		try {
			const sender = pk2addr(soloAccounts[0])

			// Compile contract A to get ABI and bytecode
			const filePath = path.resolve(process.cwd(), './contracts/A.sol')
			const abi = JSON.parse(compileContract(filePath, 'A', 'abi'))
			const bin = compileContract(filePath, 'A', 'bytecode')

			// Construct a Contract obj for A
			const c = new Contract({ abi: abi, connex: connex, bytecode: bin })

			// Generate the clause for deploying contract A
			const clause1 = c.deploy(0, 100)

			// Send the transaction and make sure it is executed
			txRep = await connex.vendor.sign('tx', [clause1])
				.signer(sender)
				.request()
			receipt = await getReceipt(connex, 5, txRep.txid)
			expect(receipt.reverted).to.equal(false)

			// Get the contract address and set it to contract A
			if (receipt.outputs[0].contractAddress !== null) {
				c.at(receipt.outputs[0].contractAddress)
			}

			// Check the stored value
			callOut = await c.call('a')
			expect(parseInt(callOut.decoded['0'])).to.equal(100)

			// Call function `set` twice
			const clause2 = c.send('set', 0, 200)
			const clause3 = c.send('set', 0, 300)

			// Send the transaction and make sure it is executed
			txRep = await connex.vendor.sign('tx', [clause2, clause3])
				.signer(sender)
				.request()
			receipt = await getReceipt(connex, 5, txRep.txid)
			expect(receipt.reverted).to.equal(false)

			// Validate the emitted `SetA` events
			let decodedEvent = decodeEvent(receipt.outputs[0].events[0], getABI(abi, 'SetA', 'event'))
			expect(parseInt(decodedEvent['val'])).to.equal(200)
			decodedEvent = decodeEvent(receipt.outputs[1].events[0], getABI(abi, 'SetA', 'event'))
			expect(parseInt(decodedEvent['val'])).to.equal(300)

			// Check the stored value
			callOut = await c.call('a')
			expect(parseInt(callOut.decoded['0'])).to.equal(300)
		} catch (e) {
			assert.fail('Error: ' + e)
		}
	})
})

function pk2addr(pk: string): string {
	return address.fromPublicKey((secp256k1.derivePublicKey(Buffer.from(pk.slice(2), 'hex'))))
}