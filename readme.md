# Writing TS Code for Testing Smart Contracts on VeChainThor

Despite the fact that VeChainThor is EVM compatible, the protocol has its unique design of constructing a transaction that can include multiple clauses representing different tasks. Moreover, each transaction is uniquely identified by a 32-byte id in the system instead of an address and nonce pair. These features make it difficult for developers to test their smart contracts on VeChainThor using tools (e.g., Truffle) built for Ethereum.

I encountered the difficulties when testing my contracts on VeChainThor and started to build my own tool [`myvetools`](https://github.com/zzGHzz/MyVeTools) to make the job easier for me. The tool is not perfect, however, it does allow me to relatively efficiently write TS code to test my contracts.

The tool could ease your job in three ways:

* It allows you to relatively easily load a particular version of the solidity compiler;
* It allows you to compile a solidity source file directly in code;
* It wraps [`Connex`](https://github.com/vechain/connex) to provide simplified methods for interacting with a Thor node.

## Installation

```
npm install myvetools
```

## Choosing Solidity Compiler Version

To download a particular version, for instance, 0.7.0, 

```
./node_modules/.bin/solcver -d 0.7.0
```

To use a particular version, for instance, 0.7.0, to compile contracts in your code,

```
./node_modules/.bin/solcver -u 0.7.0
```

## Setting up

The following is a snippet for setting up your testing code. As can be seen, it connects a Thor node identified by variable `url` and instantiates variable `connex` that implements `Connex` interfaces for interaction with the blockchain. 

```typescript
import { expect, assert } from 'chai'
import { Framework } from '@vechain/connex-framework'
import { Driver, SimpleNet, SimpleWallet } from '@vechain/connex-driver'

describe('Test contract A', () => {
	const wallet = new SimpleWallet()
	// Add private keys
	wallet.import(...)

	// Set to connect to a local Thor node
	const url = 'http://localhost:8669/'

	let driver: Driver
	let connex: Framework

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
}
```

To connect to the public testnet, you can set

```ts
const url = 'http://testnet.veblocks.net'
```

## Compiling Contract

The snippet below shows how to compile the source file of contract `A` (`./contracts/A.sol`) to get the corresponding ABI and binary code for deployment.

```ts
import path from 'path'
import { compileContract } from 'myvetools/dist/utils'

const filePath = path.resolve(process.cwd(), './contracts/A.sol')
const abi = JSON.parse(compileContract(filePath, 'A', 'abi'))
const bin = compileContract(filePath, 'A', 'bytecode')
```

## Clause and Transaction

For developers who are not familiar with VeChainThor, one important thing they need to understand is that 

> A transaction can sequentially perform **multiple** tasks (e.g., transfering tokens or calling smart contract functions) initiated by the transaction sender and each task is represented by a **clause**.

Consequently, to invoke a particular contract function causing a state change, we need to 

1. First construct a clause,
2. Put the clause inside a transaction, and
3. Send off the transaction for execution.

Please keep this process in mind and it will help you better understand the example code later. More info about the transaction model can be found [here](https://docs.vechain.org/thor/learn/transaction-model.html).

## Contract `A`

Contract `A` is a simple smart contract that basically stores an integer and allows you change its value through function `set`.

```
pragma solidity ^0.7.0;

contract A {
	uint public a;
	event SetA(uint val);

	constructor(uint _a) {
		a =  _a;
	}

	function set(uint _a) public {
		a = _a;
		emit SetA(_a);
	}
}
```
## Testing Contract `A`

To test the contract, I am going do the following things:

1. To deploy `A` with an initial value `100`
2. To call function `a` and check whether the returned value equals `100`
3. To invoke function `set` **twice within one single transaction**, setting the value to `200` and then to `300`
4. To validate the two emitted events
5. To call function `a` and check whether the returned value equals `300`

### Step 1

We first initiate an object of `Contract` to represent an instance of contract `A`:

```ts
import { Contract } from 'myvetools/dist/contract'

const c = new Contract({ abi: abi, connex: connex, bytecode: bin })
```

We then generate the clause for the deployment with initial value `100`, construct a transaction that include the clause and send off the transation to the connected node for execution:

```ts
const clause1 = c.deploy(0, 100)
const txRep = await connex.vendor.sign('tx', [clause1])
				.signer(sender)
				.request()
```

After that, we check the receipt of the transaction and check whether it has been successfully executed (or not reverted):

```ts
import { getReceipt } from 'myvetools/dist/connexUtils'

const receipt = await getReceipt(connex, 5, txRep.txid)
expect(receipt.reverted).to.equal(false)
```

Here, the transaction is identified by its ID, kept by `txRep.txid`, which is then passed to function `getReceipt` to get its receipt from the ledger.

The next thing to do is to obtain the contract address and set the address in `c`:

```ts
if (receipt.outputs[0].contractAddress !== null) {
	c.at(receipt.outputs[0].contractAddress)
}
```

### Step 2

```ts
const callOut = await c.call('a')
expect(parseInt(callOut.decoded['0'])).to.equal(100)
```

### Step 3

```ts
const clause2 = c.send('set', 0, 200)
const clause3 = c.send('set', 0, 300)
txRep = await connex.vendor.sign('tx', [clause2, clause3])
			.signer(sender)
			.request()
```

Here, two clauses are constructed and put in one single transaction. Note that clauses are executed by the order they put in the array passed to function `sign`. Therefore, the stored value will be changed to `200` and then to `300`.

### Step 4

```ts
import { decodeEvent } from 'myvetools/dist/connexUtils'
import { getABI } from 'myvetools/dist/utils'

let decodedEvent = decodeEvent(receipt.outputs[0].events[0], getABI(abi, 'SetA', 'event'))
expect(parseInt(decodedEvent['val'])).to.equal(200)
decodedEvent = decodeEvent(receipt.outputs[1].events[0], getABI(abi, 'SetA', 'event'))
expect(parseInt(decodedEvent['val'])).to.equal(300)
```

Here, `receipt` has two elements in its field `outputs`, corresponding to the outputs for two included clauses, respectively.

### Step 5

```ts
const callOut = await c.call('a')
expect(parseInt(callOut.decoded['0'])).to.equal(300)
```

