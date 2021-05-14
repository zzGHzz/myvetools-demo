# Writing TS Code for Testing Smart Contracts on VeChainThor

Despite the fact that VeChainThor is EVM compatible, the protocol has its unique design of constructing a transaction that can include multiple clauses representing different tasks. Moreover, each transaction is uniquely identified by a 32-byte id in the system instead of an address and nonce pair. These features make it difficult for developers to test their smart contracts on VeChainThor using tools (e.g., Truffle) built for Ethereum.

I encountered the difficulties and started to build my own tool [`myvetools`](https://github.com/zzGHzz/MyVeTools) to make the job easier for me. The tool is not perfect, however, it does allow me to relatively efficiently write TS code to test my contracts. I feel like it may be worth sharing it with other developers.

The tool could ease your job in three ways:

* It allows you to relatively easily load a particular version of the solidity compiler;
* It allows you to compile a solidity source file directly in code;
* It wraps [`Connex`](https://github.com/vechain/connex) to provide methods that simplify the interaction with a Thor node.

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

## Compiling Contract

The snippet below shows how to compile the source file of contract `A`, named `A.sol`, to get the corresponding ABI and binary code for deployment.

```ts
import { compileContract } from 'myvetools/dist/utils'

const abi = JSON.parse(compileContract(`path/to/A.sol`, 'A', 'abi'))
const bin = compileContract(filePath, 'A', 'bytecode')
```

## An Example

I made a simple [example](https://github.com/zzGHzz/myvetools-demo) to demonstrate how we can use `myvetools` to write code for testing a smart contract. I'm going to explain the example in the rest of this article.

### Setup

The following is a snippet for setting up your code for testing. It connects a Thor node identified by variable `url` and instantiates variable `connex` that implements `Connex` interfaces for interacting with a Thor node. 

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
})
```

To connect to a public testnet node, you can try

```ts
const url = 'http://testnet.veblocks.net'
```

`myvetools` also provides a commandline tool to create a template TS file that includes the above snippet:

```bash
node_modules/.bin/mvt -c <FILE>
```

### Clause and Transaction

For developers who are not familiar with VeChainThor, one important thing they need to understand is that 

> With VeChainThor, a transaction can sequentially perform *multiple* tasks (e.g., transfering tokens or calling smart contracts), all initiated by the same transaction sender. 

> Each task is represented by a *clause* in the system.

Consequently, to invoke a particular contract function causing a state change, we need to 

1. First construct a clause that does the job,
2. Put the clause inside a transaction, and
3. Send off the transaction for execution.

Please keep this process in mind and it will help you better understand the example code later. More info about the transaction model can be found [here](https://docs.vechain.org/thor/learn/transaction-model.html).

### Target Contract

Contract `A` is created for this demo. It is a simple smart contract that basically stores an integer and allows you change its value through function `set`.

```solidity
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
### Testing Contract `A`

To test contract `A`, I'm going to do the following things:

1. To deploy `A` with an initial value `100`
2. To call function `a` and check whether the returned value equals `100`
3. To invoke function `set` **twice within one single transaction**, setting the value to `200` and then to `300`
4. To validate the two emitted `SetA` events
5. To call function `a` and check whether the returned value equals `300`

Note that the complete code for testing contract `A` can be found [here](https://github.com/zzGHzz/myvetools-demo/blob/main/test.ts).

#### Step 1

We first initiate an object of `Contract` to represent an instance of contract `A`:

```ts
import { Contract } from 'myvetools/dist/contract'

const c = new Contract({ abi: abi, connex: connex, bytecode: bin })
```

> Recall the relationship between clause and transaction. 

We then generate the clause for deploying the contract with an initial value `100`, put the clause inside a transaction and send off the transation to the Thor node for execution:

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

Here, the transaction is identified by its ID, kept by `txRep.txid`, which is then passed to function `getReceipt`.

The next thing to do is to obtain the contract address and set the address in `c`:

```ts
if (receipt.outputs[0].contractAddress !== null) {
	c.at(receipt.outputs[0].contractAddress)
}
```

#### Step 2

```ts
const callOut = await c.call('a')
expect(parseInt(callOut.decoded['0'])).to.equal(100)
```

#### Step 3

```ts
const clause2 = c.send('set', 0, 200)
const clause3 = c.send('set', 0, 300)
txRep = await connex.vendor.sign('tx', [clause2, clause3])
	.signer(sender)
	.request()
```

Here, two clauses are constructed and put in one single transaction. Note that clauses are executed by the order they put in the array passed to function `sign`. Therefore, the integer kept by the contract will be changed to `200` and then to `300`.

#### Step 4

```ts
import { decodeEvent } from 'myvetools/dist/connexUtils'
import { getABI } from 'myvetools/dist/utils'

const expected = [200, 300]
receipt.outputs.forEach((output, i) => {
	const decoded = decodeEvent(
		output.events[0],
		getABI(abi, 'SetA', 'event')
	)
	expect(parseInt(decoded['val'])).to.equal(expected[i])
})
```

Here, `receipt` has two elements in its field `outputs`, corresponding to the outputs for two included clauses, respectively.

#### Step 5

```ts
const callOut = await c.call('a')
expect(parseInt(callOut.decoded['0'])).to.equal(300)
```

