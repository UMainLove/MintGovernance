const { ethers } = require("hardhat");
const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

//const { parseEther, keccak256, toUtf8Bytes } = require("ethers");

async function mineBlocks(blockNumber) {
  for (let i = 0; i < blockNumber; i++) {
    await ethers.provider.send("evm_mine");
  }
}

describe("Governance System", function () {
  async function deployFixture() {
    const [owner, otherAccount] = await ethers.getSigners();

    const MyToken = await ethers.getContractFactory("MyToken");
    const token = await MyToken.deploy(owner.address, owner.address);

    const MyGovernor = await ethers.getContractFactory("MyGovernor");
    const governor = await MyGovernor.deploy(await token.getAddress());

    // Grant MINTER_ROLE to the Governor contract
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, await governor.getAddress());

    await token.delegate(owner.address);

    return { governor, token, owner, otherAccount };
  }

  describe("MyToken", function () {
    it("should provide the owner with a starting balance", async () => {
      const { token, owner } = await loadFixture(deployFixture);

      const balance = await token.balanceOf(owner.address);
      expect(balance).to.equal(ethers.parseEther("10000"));
    });

    it("should allow minting by MINTER_ROLE", async () => {
      const { token, otherAccount } = await loadFixture(deployFixture);

      await token.mint(otherAccount.address, ethers.parseEther("1000"));

      const balance = await token.balanceOf(otherAccount.address);
      expect(balance).to.equal(ethers.parseEther("1000"));
    });

    it("should not allow minting by non-MINTER_ROLE", async () => {
      const { token, otherAccount } = await loadFixture(deployFixture);

      const minterRole = await token.MINTER_ROLE();
      await expect(token.connect(otherAccount).mint(otherAccount.address, ethers.parseEther("1000")))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(otherAccount.address, minterRole);
    });
  });

  describe("MyGovernor", function () {
    async function proposeFixture() {
      const deployValues = await deployFixture();
      const { governor, token, owner } = deployValues;

      const proposalDescription = "Mint more tokens to the owner";
      const encodedFunctionCall = token.interface.encodeFunctionData("mint", [owner.address, ethers.parseEther("1000")]);

      const proposeTx = await governor.propose(
        [await token.getAddress()],
        [0],
        [encodedFunctionCall],
        proposalDescription
      );

      const proposeReceipt = await proposeTx.wait();
      const proposalId = proposeReceipt.logs[0].args.proposalId;

      return { ...deployValues, proposalId, encodedFunctionCall, proposalDescription };
    }

    it("should allow creating a proposal", async () => {
      const { governor, proposalId } = await loadFixture(proposeFixture);

      expect(await governor.state(proposalId)).to.equal(0); // Pending
    });

    it("should transition to active state after voting delay", async () => {
      const { governor, proposalId } = await loadFixture(proposeFixture);

      const votingDelay = await governor.votingDelay();
      await mineBlocks(Number(votingDelay) + 1);

      await ethers.provider.send("evm_increaseTime", [Number(votingDelay)]);
      await ethers.provider.send("evm_mine");
      

      expect(await governor.state(proposalId)).to.equal(1); // Active
    });

    it("should allow voting on an active proposal", async () => {
      const { governor, proposalId, owner } = await loadFixture(proposeFixture);

      const votingDelay = await governor.votingDelay();
      await mineBlocks(Number(votingDelay) + 1);

      await ethers.provider.send("evm_increaseTime", [Number(await governor.votingDelay())]);
      await ethers.provider.send("evm_mine");

      await expect(governor.castVote(proposalId, 1)) // 1 for 'For'
        .to.emit(governor, "VoteCast")
        .withArgs(owner.address, proposalId, 1, ethers.parseEther("10000"), "");
    });

    it("should execute a successful proposal", async () => {
      this.timeout(60000);
      const { governor, token, owner, proposalId, encodedFunctionCall, proposalDescription } = await loadFixture(proposeFixture);

      const votingDelay = await governor.votingDelay();
      await mineBlocks(Number(votingDelay) + 1);

      // Move to active state
      await ethers.provider.send("evm_increaseTime", [Number(await governor.votingDelay())]);
      await ethers.provider.send("evm_mine");

      // Vote
      await governor.castVote(proposalId, 1);
      

      const votingPeriod = await governor.votingPeriod();
      await mineBlocks(Number(votingPeriod) + 1);

      // Move past voting period
      await ethers.provider.send("evm_increaseTime", [Number(await governor.votingPeriod())]);
      await ethers.provider.send("evm_mine");

      const quorum = await governor.quorum(await ethers.provider.getBlockNumber() - 1);
      console.log("Quorum:", quorum.toString());

      const { againstVotes, forVotes, abstainVotes } = await governor.proposalVotes(proposalId);
      console.log("Votes - For:", forVotes.toString(), "Against:", againstVotes.toString(), "Abstain:", abstainVotes.toString());


      // Queue and execute
      const descriptionHash = ethers.id(proposalDescription);

      try {
      await governor.execute(
        [await token.getAddress()],
        [0],
        [encodedFunctionCall],
        descriptionHash
      );
      console.log("Proposal executed successfully");
      } catch (error) {
        console.error("Error executing proposal:", error.message);
        throw error;
      }

      // Check if the proposal was executed (tokens minted)
      const newBalance = await token.balanceOf(owner.address);
      expect(newBalance).to.equal(ethers.parseEther("11000")); // 10000 initial + 1000 minted
    });
  });
});