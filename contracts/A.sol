// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

contract A {
	uint public a;
	event SetA(uint val);

	constructor(uint _a) {
		a =  _a;
	}

	function set(uint _a) public {
		a = _a;
		emit SetA(a);
	}
}