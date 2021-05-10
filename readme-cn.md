# 在唯链雷神区块链上开发用于测试智能合约的TS代码

唯链雷神区块链是一个兼容 EVM 的公链系统。它自有拥有一些独特的设计使其区别于其他公链系统，比如它允许每个交易能够执行多个任务，又比如每个交易都是通过一个唯一的32字节的 ID 来标识，而其他公链（比如以太坊）大多是通过账户加上当前发送交易数的组合来唯一标识一笔交易。虽然这些独特的设计能够简化系统设计并提升效率，它们也给开发者在合约开发测试上带来了不便，因为开发者不能够直接使用那些以太生态内的工具 (比如 Truffle)。作为一个开发者，我也遇到了同样的问题，所以我着手开发自己的工具 [`myvetools`](https://github.com/zzGHzz/MyVeTools) 来帮助我能够比较高效地开发 TS 代码，用于智能合约的测试工作。

这个工具主要是在以下三个方面帮到开发者：

1. 允许开发者比较容易地下载想要使用的 solidity 编译器版本；
2. 能够让开发者直接在代码中直接编译 solidity 源代码；
3. 基于 [`Connex`](https://github.com/vechain/connex) 为开发者提供了更为方便的和区块链节点交互的接口。

## 工具安装

```
npm install myvetools
```

## 选择 Solidity 编译器版本

通过以下命令可以下载指定版本的 solidity 编译器，比如 `0.7.0` 版本：

```
./node_modules/.bin/solcver -d 0.7.0
```

通过以下命令使用特定版本的 solidity 编译器，比如 `0.7.0` 版本：

```
./node_modules/.bin/solcver -u 0.7.0
```

## 合约编译

以下代码片段展示了如何在代码中直接编译合约 `A` 的源文件，从而得到它的 ABI 和用于部署的合约执行代码。

```ts
import { compileContract } from 'myvetools/dist/util·s'

const abi = JSON.parse(compileContract(`path/to/A.sol`, 'A', 'abi'))
const bin = compileContract(filePath, 'A', 'bytecode')
```

## 例子

我写了一个简单的[例子](https://github.com/zzGHzz/myvetools-demo)，为了读者能够更好地了解如何使用 `myvetools` 来写测试合约的代码。这篇文章的剩余部分将详细地介绍这个例子。

### 创建测试代码

你可以通过以下代码片段来创建你的测试代码。其中你需要通过设置变量 `url` 来链接一个指定的节点。当链接成功后，你会得到一个 `Connex` 的对象，用于之后于区块链交互。

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

你可以设置 `url` 为以下链接，来链接一个测试网节点：

```ts
const url = 'http://testnet.veblocks.net'
```

### 子句（Clause）与交易（Transaction）

对于不熟悉唯链的开发者，有一个很重要的概念他们需要理解。

> 在唯链雷神区块链系统里，每一笔交易都可以按顺序执行多个任务（比如，转代币或者是调用合约）。值得注意的是，这些任务都是由同一个账号发起，也就是这笔交易的发起者。每个任务在系统里都是由一个子句的实现的。

所以，如果要调用智能合约改变合约状态，我们需要做以下的步骤：

1. 首先需要创建一个子句用于调用相关合约函数，
2. 其次需要把该子句放进一个交易，
3. 发送交易到区块链网络执行。

请务必把以上流程铭记在心，以便之后能够更好地理解下文要展示的代码片段。更多关于唯链交易模型的信息可以在[这里](https://docs.vechain.org/thor/learn/transaction-model.html)找到。

### 测试目标合约

合约 `A` 是我为了展示写的一个简单的合约，主要的功能是在合约内存储一个非负整数，可以通过 `set` 方法来更新。

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
### 测试合约 `A`

我将会做以下事情来测试合约 `A`：

1. 部署合约并把 `100` 作为初始值传入
2. 调用合约函数 `a` 并检查返回值是不是等于 `100`
3. 在同一个交易中调用合约函数 `set` 两次，先后更新合约内存储的整数为 `200` 和 `300`
4. 验证调用合约产生的 `SetA` 事件
5. 调用合约函数 `a` 并检查返回值是不是等于 `300`

请注意，完整的测试代码可以在[这里](https://github.com/zzGHzz/myvetools-demo/blob/main/test.ts)找到。

#### 步骤一

首先我们为合约 `A` 创建一个 `Contract` 实例 `c`：

```ts
import { Contract } from 'myvetools/dist/contract'

const c = new Contract({ abi: abi, connex: connex, bytecode: bin })
```

在以下的代码片段中，我们生成一个用于部署合约的子句，并且把这个子句放入一个交易，然后发送交易到连接的节点：

```ts
const clause1 = c.deploy(0, 100)
const txRep = await connex.vendor.sign('tx', [clause1])
	.signer(sender)
	.request()
```

之后我们通过 `getReceipt` 得到交易的收据，并且检查该交易是不是被正确地执行了，或者说是交易没有被无效：

```ts
import { getReceipt } from 'myvetools/dist/connexUtils'

const receipt = await getReceipt(connex, 5, txRep.txid)
expect(receipt.reverted).to.equal(false)
```

我们可以看到该交易是用其 ID 来标识，这个 ID 被存储在 `txRep.txid`。之后我们需要从收据中得到创建的合约地址，并且记录到 `c` 里：

```ts
if (receipt.outputs[0].contractAddress !== null) {
	c.at(receipt.outputs[0].contractAddress)
}
```

#### 步骤二

```ts
const callOut = await c.call('a')
expect(parseInt(callOut.decoded['0'])).to.equal(100)
```

#### 步骤三

```ts
const clause2 = c.send('set', 0, 200)
const clause3 = c.send('set', 0, 300)
txRep = await connex.vendor.sign('tx', [clause2, clause3])
	.signer(sender)
	.request()
```

这里我们生成了两个子句来调用合约的 `set` 函数，并且把它们放入同一个交易中。需要注意的地方是，子句的执行顺序是按照它们在数组里的先后顺序。所以当执行完该交易时，合约中的整数先被设为 `200`，然后才是 `300`。

#### 步骤四

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

这里收据的 `outputs` 域中包含两个输出，分别对应与交易中的两个子句。

#### 步骤五

```ts
const callOut = await c.call('a')
expect(parseInt(callOut.decoded['0'])).to.equal(300)
```

