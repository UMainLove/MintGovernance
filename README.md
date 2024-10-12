# Sample Hardhat Project

This project demonstrates how to use an ERC20 for governance. The token will have two purposes:

It will be the token used for voting weight in our Governor contract.
It will have a mint function which can only be called when a proposal from the token holders has been successfully executed.

The contracts are developed using @openzeppelin/contracts Wizard V5

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.js
```
