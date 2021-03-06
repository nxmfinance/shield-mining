const { ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');
const { accounts, web3, contract } = require('@openzeppelin/test-environment');
const { assert } = require('chai');
const { setup } = require('./setup');
const CommunityStakingIncentives = contract.fromArtifact('CommunityStakingIncentives');
const BN = web3.utils.BN;

const firstContract = '0x0000000000000000000000000000000000000001';
const secondContract = '0x0000000000000000000000000000000000000002';
const thirdContract = '0x0000000000000000000000000000000000000003';
const rewardRateScale = new BN('10').pow(new BN('18'));

function getUniqueRewardTuples (events) {
  const set = new Set(events.map(e => `${e.stakedContract}|${e.sponsor}|${e.tokenAddress}`));
  return Array.from(set).map(s => {
    const chunks = s.split('|');
    return {
      stakedContract: chunks[0],
      sponsor: chunks[1],
      tokenAddress: chunks[2],
    };
  });
}

describe('claimRewards', function () {
  this.timeout(5000);

  const [
    sponsor1,
    sponsor2,
    sponsor3,
    sponsor4,
    sponsor5,
    staker1,
    staker2,
  ] = accounts;

  beforeEach(setup);

  it('should send reward funds to claiming staker and emit Claimed event', async function () {
    const { incentives, mockTokenA, pooledStaking } = this;

    const sponsor = sponsor1;

    await mockTokenA.mint(sponsor, ether('100'));

    const totalRewards = ether('10');
    await mockTokenA.approve(incentives.address, totalRewards, {
      from: sponsor,
    });
    await incentives.depositRewards(firstContract, mockTokenA.address, totalRewards, {
      from: sponsor,
    });
    const rewardRate = rewardRateScale;
    await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate, {
      from: sponsor,
    });

    const staker1Stake = ether('4');
    const staker1PendingUnstake = ether('3');
    const staker1NetStake = staker1Stake.sub(staker1PendingUnstake);
    await pooledStaking.setStakerContractStake(staker1, firstContract, staker1Stake);
    await pooledStaking.setStakerContractPendingUnstakeTotal(staker1, firstContract, staker1PendingUnstake);

    const expectedRewardClaimedAmount = staker1NetStake.mul(rewardRate).div(rewardRateScale);
    const [availableRewards] = await incentives.getAvailableStakerRewards(
      staker1, [firstContract], [sponsor], [mockTokenA.address],
    );
    assert.equal(availableRewards.toString(), expectedRewardClaimedAmount.toString());
    const tokensClaimed = await incentives.claimRewards.call([firstContract], [sponsor], [mockTokenA.address], {
      from: staker1,
    });
    const tx = await incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], {
      from: staker1,
    });
    await expectEvent(tx, 'Claimed', {
      stakedContract: firstContract,
      sponsor,
      tokenAddress: mockTokenA.address,
      amount: expectedRewardClaimedAmount.toString(),
      receiver: staker1,
      roundNumber: '1',
    });
    assert.equal(tokensClaimed.length, 1);
    assert.equal(tokensClaimed[0].toString(), expectedRewardClaimedAmount.toString());
    const postRewardBalance = await mockTokenA.balanceOf(staker1);
    assert.equal(postRewardBalance.toString(), expectedRewardClaimedAmount.toString());
  });

  it('should revert when staker attempts to claim reward two times within 1 round', async function () {
    const { incentives, mockTokenA, pooledStaking } = this;

    const sponsor = sponsor1;

    await mockTokenA.mint(sponsor, ether('100'));

    const totalRewards = ether('10');
    await mockTokenA.approve(incentives.address, totalRewards, {
      from: sponsor,
    });
    await incentives.depositRewards(firstContract, mockTokenA.address, totalRewards, {
      from: sponsor,
    });
    const rewardRate = rewardRateScale;
    await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate, {
      from: sponsor,
    });

    const staker1Stake = ether('4');
    const staker1PendingUnstake = ether('3');
    await pooledStaking.setStakerContractStake(staker1, firstContract, staker1Stake);
    await pooledStaking.setStakerContractPendingUnstakeTotal(staker1, firstContract, staker1PendingUnstake);

    await incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], {
      from: staker1,
    });

    const [availableRewards] = await incentives.getAvailableStakerRewards(
      staker1, [firstContract], [sponsor], [mockTokenA.address],
    );
    assert.equal(availableRewards.toString(), '0');
    await expectRevert(
      incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], { from: staker1 }),
      'Already claimed this reward for this round',
    );
  });

  it('should send reward funds to claiming staker for 2 rounds at different rates and update pool rate for 2nd round for current' +
    'and next claim within the round from the pool', async function () {
    const { incentives, mockTokenA, pooledStaking } = this;

    const sponsor = sponsor1;

    await mockTokenA.mint(sponsor, ether('100'));

    const totalRewards = ether('10');
    await mockTokenA.approve(incentives.address, totalRewards, {
      from: sponsor,
    });
    await incentives.depositRewards(firstContract, mockTokenA.address, totalRewards, {
      from: sponsor,
    });
    const rewardRate = rewardRateScale;
    await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate, {
      from: sponsor,
    });

    const staker1Stake = ether('4');
    const staker1PendingUnstake = ether('3');
    const staker2Stake = ether('5');
    const staker2PendingUnstake = ether('3');
    const staker1NetStake = staker1Stake.sub(staker1PendingUnstake);
    await pooledStaking.setStakerContractStake(staker1, firstContract, staker1Stake);
    await pooledStaking.setStakerContractPendingUnstakeTotal(staker1, firstContract, staker1PendingUnstake);

    // staker 2
    const staker2NetStake = staker2Stake.sub(staker2PendingUnstake);
    await pooledStaking.setStakerContractStake(staker2, firstContract, staker2Stake);
    await pooledStaking.setStakerContractPendingUnstakeTotal(staker2, firstContract, staker2PendingUnstake);

    const expectedRewardClaimedAmount = staker1NetStake.mul(rewardRate).div(rewardRateScale);
    const [availableRewards] = await incentives.getAvailableStakerRewards(
      staker1, [firstContract], [sponsor], [mockTokenA.address],
    );
    assert.equal(availableRewards.toString(), expectedRewardClaimedAmount.toString());
    const tokensClaimed = await incentives.claimRewards.call([firstContract], [sponsor], [mockTokenA.address], {
      from: staker1,
    });
    const tx = await incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], {
      from: staker1,
    });

    assert.equal(tokensClaimed.length, 1);
    assert.equal(tokensClaimed[0].toString(), expectedRewardClaimedAmount.toString());

    const postRewardBalance = await mockTokenA.balanceOf(staker1);
    assert.equal(postRewardBalance.toString(), expectedRewardClaimedAmount.toString());

    const rewardRate2ndRound = rewardRateScale.muln(2);
    await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate2ndRound, {
      from: sponsor,
    });

    let pool = await incentives.getRewardPool(firstContract, sponsor, mockTokenA.address);
    assert.equal(pool.rate.toString(), rewardRate.toString());
    assert.equal(pool.nextRate.toString(), rewardRate2ndRound.toString());
    assert.equal(pool.nextRateStartRound.toString(), '2');

    const roundDuration = (await incentives.roundDuration()).addn(10);
    await time.increase(roundDuration);

    pool = await incentives.getRewardPool(firstContract, sponsor, mockTokenA.address);
    assert.equal(pool.rate.toString(), rewardRate2ndRound.toString());
    assert.equal(pool.nextRate.toString(), '0');
    assert.equal(pool.nextRateStartRound.toString(), '0');

    const expectedRewardClaimedAmountRound2 = staker1NetStake.mul(rewardRate2ndRound).div(rewardRateScale);
    const [availableRewardsRound2] = await incentives.getAvailableStakerRewards(
      staker1, [firstContract], [sponsor], [mockTokenA.address],
    );
    assert.equal(availableRewardsRound2.toString(), expectedRewardClaimedAmountRound2.toString());

    const txRound2 = await incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], {
      from: staker1,
    });
    await expectEvent(txRound2, 'Claimed', {
      stakedContract: firstContract,
      sponsor,
      tokenAddress: mockTokenA.address,
      amount: expectedRewardClaimedAmountRound2.toString(),
      receiver: staker1,
      roundNumber: '2',
    });

    pool = await incentives.getRewardPool(firstContract, sponsor, mockTokenA.address);
    assert.equal(pool.rate.toString(), rewardRate2ndRound.toString());
    assert.equal(pool.nextRate.toString(), '0');
    assert.equal(pool.nextRateStartRound.toString(), '0');

    const [availableRewardsRound2PostClaim] = await incentives.getAvailableStakerRewards(
      staker1, [firstContract], [sponsor], [mockTokenA.address],
    );
    assert.equal(availableRewardsRound2PostClaim.toString(), '0');

    const txRound2Staker2 = await incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], {
      from: staker2,
    });

    const expectedRewardClaimedAmountRound2Staker2 = staker2NetStake.mul(rewardRate2ndRound).div(rewardRateScale);
    await expectEvent(txRound2Staker2, 'Claimed', {
      stakedContract: firstContract,
      sponsor,
      tokenAddress: mockTokenA.address,
      amount: expectedRewardClaimedAmountRound2Staker2.toString(),
      receiver: staker2,
      roundNumber: '2',
    });

    // pool rates stay the same for this subsequent claim.
    pool = await incentives.getRewardPool(firstContract, sponsor, mockTokenA.address);
    assert.equal(pool.rate.toString(), rewardRate2ndRound.toString());
    assert.equal(pool.nextRate.toString(), '0');
    assert.equal(pool.nextRateStartRound.toString(), '0');
  });

  it('should send reward funds to claiming staker and emit Claimed event for multiple rounds', async function () {
    const { incentives, mockTokenA, pooledStaking } = this;

    const sponsor = sponsor1;
    await mockTokenA.mint(sponsor, ether('10000'));
    const totalRewards = ether('1000');

    let rewardRate = rewardRateScale;
    await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate, {
      from: sponsor,
    });

    const roundCount = 5;
    for (let i = 0; i < roundCount; i++) {
      await mockTokenA.approve(incentives.address, totalRewards, {
        from: sponsor,
      });
      await incentives.depositRewards(firstContract, mockTokenA.address, totalRewards, {
        from: sponsor,
      });

      const expectedRewardRate = rewardRate;
      rewardRate = rewardRate.muln(2);
      await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate, {
        from: sponsor,
      });
      let pool = await incentives.getRewardPool(firstContract, sponsor, mockTokenA.address);
      assert.equal(pool.rate.toString(), expectedRewardRate.toString());
      assert.equal(pool.nextRate.toString(), rewardRate.toString());
      assert.equal(pool.nextRateStartRound.toString(), (i + 2).toString());

      const staker1Stake = ether('4');
      const staker1PendingUnstake = ether('3');
      const staker1NetStake = staker1Stake.sub(staker1PendingUnstake);
      await pooledStaking.setStakerContractStake(staker1, firstContract, staker1Stake);
      await pooledStaking.setStakerContractPendingUnstakeTotal(staker1, firstContract, staker1PendingUnstake);

      const expectedRewardClaimedAmount = staker1NetStake.mul(expectedRewardRate).div(rewardRateScale);
      const [availableRewards] = await incentives.getAvailableStakerRewards(
        staker1, [firstContract], [sponsor], [mockTokenA.address],
      );
      assert.equal(availableRewards.toString(), expectedRewardClaimedAmount.toString(), `Failed on round ${i + 1}`);
      const tokensClaimed = await incentives.claimRewards.call([firstContract], [sponsor], [mockTokenA.address], {
        from: staker1,
      });
      const tx = await incentives.claimRewards([firstContract], [sponsor], [mockTokenA.address], {
        from: staker1,
      });

      pool = await incentives.getRewardPool(firstContract, sponsor, mockTokenA.address);
      assert.equal(pool.rate.toString(), expectedRewardRate);
      assert.equal(pool.nextRate.toString(), rewardRate.toString());
      assert.equal(pool.nextRateStartRound.toString(), (i + 2).toString());

      const expectedRoundNumber = (i + 1).toString();
      await expectEvent(tx, 'Claimed', {
        stakedContract: firstContract,
        sponsor,
        tokenAddress: mockTokenA.address,
        amount: expectedRewardClaimedAmount.toString(),
        receiver: staker1,
        roundNumber: expectedRoundNumber,
      });
      assert.equal(tokensClaimed.length, 1);
      assert.equal(tokensClaimed[0].toString(), expectedRewardClaimedAmount.toString());
      const lastRoundClaimed = await incentives.getLastRoundClaimed(firstContract, sponsor, mockTokenA.address, staker1);
      assert.equal(lastRoundClaimed.toString(), expectedRoundNumber.toString());

      const roundDuration = (await incentives.roundDuration()).addn(10);
      await time.increase(roundDuration);
    }
  });

  it('should send reward funds to claiming staker for multiple sponsors with varying contracts, reward rates and tokens',
    async function () {
      const { incentives, mockTokenA, mockTokenB, mockTokenC, pooledStaking } = this;
      const sponsors = [sponsor1, sponsor2, sponsor3, sponsor4, sponsor5];

      const testRewardPools = [{
        sponsor: sponsor1,
        token: mockTokenA,
        rewardRate: rewardRateScale,
        contract: firstContract,
      }, {
        sponsor: sponsor2,
        token: mockTokenA,
        rewardRate: rewardRateScale.muln(2),
        contract: secondContract,
      }, {
        sponsor: sponsor3,
        token: mockTokenB,
        rewardRate: rewardRateScale.muln(3),
        contract: thirdContract,
      }, {
        sponsor: sponsor4,
        token: mockTokenB,
        rewardRate: rewardRateScale.muln(4),
        contract: firstContract,
      }, {
        sponsor: sponsor5,
        token: mockTokenC,
        rewardRate: rewardRateScale.muln(5),
        contract: secondContract,
      }];

      const stakes = {};
      stakes[firstContract] = {
        stakerStake: ether('4'),
        stakerPendingUnstake: ether('3'),
      };
      stakes[secondContract] = {
        stakerStake: ether('2'),
        stakerPendingUnstake: ether('0'),
      };
      stakes[thirdContract] = {
        stakerStake: ether('10'),
        stakerPendingUnstake: ether('7'),
      };

      Object.values(stakes).forEach(stake => {
        stake.netStake = stake.stakerStake.sub(stake.stakerPendingUnstake);
      });

      const tokens = testRewardPools.map(pool => pool.token);
      const tokensByAddress = {};
      for (const token of tokens) {
        tokensByAddress[token.address] = token;
      }

      const baseRewardFund = ether('10');
      let multiplier = 1;
      const rewardFunds = [];
      for (const testRewardPool of testRewardPools) {
        await testRewardPool.token.mint(testRewardPool.sponsor, ether('100'));
        const totalRewards = baseRewardFund.muln(multiplier++);
        rewardFunds.push(totalRewards);
        await testRewardPool.token.approve(incentives.address, totalRewards, {
          from: testRewardPool.sponsor,
        });
        await incentives.depositRewards(testRewardPool.contract, testRewardPool.token.address, totalRewards, {
          from: testRewardPool.sponsor,
        });
        await incentives.setRewardRate(testRewardPool.contract, testRewardPool.token.address, testRewardPool.rewardRate, {
          from: testRewardPool.sponsor,
        });
      }

      for (const stakedContract in stakes) {
        await pooledStaking.setStakerContractStake(staker1, stakedContract, stakes[stakedContract].stakerStake);
        await pooledStaking.setStakerContractPendingUnstakeTotal(
          staker1, stakedContract, stakes[stakedContract].stakerPendingUnstake,
        );
      }

      const stakedContracts = testRewardPools.map(pool => pool.contract);
      const tokenAddresses = tokens.map(token => token.address);

      const tokensClaimed = await incentives.claimRewards.call(stakedContracts, sponsors, tokenAddresses, {
        from: staker1,
      });
      await incentives.claimRewards(stakedContracts, sponsors, tokenAddresses, {
        from: staker1,
      });

      assert.equal(tokensClaimed.length, testRewardPools.length);
      const expectedClaimAmounts = testRewardPools
        .map(pool => stakes[pool.contract].netStake.mul(pool.rewardRate).div(rewardRateScale));
      for (let i = 0; i < tokensClaimed.length; i++) {
        const claimAmount = tokensClaimed[i];
        assert.equal(claimAmount.toString(), expectedClaimAmounts[i].toString(), `claimAmount does not match for test pool ${i}`);
      }

      const expectedClaimAmountsByTokenAddress = {};
      for (let i = 0; i < tokenAddresses.length; i++) {
        const address = tokenAddresses[i];
        if (!expectedClaimAmountsByTokenAddress[address]) {
          expectedClaimAmountsByTokenAddress[address] = new BN('0');
        }
        expectedClaimAmountsByTokenAddress[address] = expectedClaimAmountsByTokenAddress[address].add(tokensClaimed[i]);
      }

      for (const tokenAddress of Object.keys(expectedClaimAmountsByTokenAddress)) {
        const expectedBalance = expectedClaimAmountsByTokenAddress[tokenAddress];
        const postRewardBalance = await tokensByAddress[tokenAddress].balanceOf(staker1);
        const name = await tokensByAddress[tokenAddress].name();
        assert.equal(postRewardBalance.toString(), expectedBalance.toString(), `Reward balance does not match for token ${name}`);
      }
    });
});

describe('claimRewards before roundsStartTime', function () {
  this.timeout(5000);

  const [
    sponsor,
    staker1,
  ] = accounts;
  const masterAddress = '0x0000000000000000000000000000000000000001';
  const tokenAddress = '0x0000000000000000000000000000000000000002';

  beforeEach(async function () {
    const latest = (await time.latest()).toNumber();
    const roundsStartTime = latest + 10;
    const roundDuration = 14 * 24 * 60 * 60;
    const incentives = await CommunityStakingIncentives.new(roundDuration, roundsStartTime, masterAddress);
    this.incentives = incentives;
  });

  it('reverts if staker attempts to claim rewards', async function () {
    const { incentives } = this;
    await expectRevert(
      incentives.claimRewards([firstContract], [sponsor], [tokenAddress], { from: staker1 }),
      `Rounds haven't started yet`,
    );
  });
});

describe('detecting all available sponsors from Deposited and claiming all available rewards', function () {
  const [
    sponsor1,
    sponsor2,
    sponsor3,
    sponsor4,
    sponsor5,
    staker1,
  ] = accounts;
  beforeEach(setup);

  it('should detect all available rewards for a user using Deposited events and compute all withdrawable reward values', async function () {
    const { incentives, mockTokenA, pooledStaking } = this;

    const sponsors = [sponsor1, sponsor2, sponsor3, sponsor4, sponsor5];

    const staker = staker1;
    const baseRewardFund = ether('10');
    let rewardRate;
    let multiplier = 1;
    const rewardRates = {};
    const rewardFunds = [];
    for (const sponsor of sponsors) {
      await mockTokenA.mint(sponsor, ether('100'));
      rewardRate = rewardRateScale.muln(multiplier);
      const totalRewards = baseRewardFund.muln(multiplier++);
      rewardFunds.push(totalRewards);
      await mockTokenA.approve(incentives.address, totalRewards, {
        from: sponsor,
      });
      await incentives.depositRewards(firstContract, mockTokenA.address, totalRewards, {
        from: sponsor,
      });
      await incentives.setRewardRate(firstContract, mockTokenA.address, rewardRate, {
        from: sponsor,
      });
      rewardRates[sponsor] = rewardRate;
    }

    const stakerStake = ether('6');
    const stakerPendingUnstake = ether('5');
    const stakerNetStake = stakerStake.sub(stakerPendingUnstake);
    await pooledStaking.setStakerContractStake(staker, firstContract, stakerNetStake);

    const contracts = await pooledStaking.stakerContractsArray(staker);

    const pastEvents = await incentives.getPastEvents('Deposited', {
      fromBlock: 0,
      filter: {
        stakedContract: contracts,
      },
    });
    const tuples = getUniqueRewardTuples(pastEvents.map(e => e.args));

    const stakedContractsArray = tuples.map(t => t.stakedContract);
    const sponsorsArray = tuples.map(t => t.sponsor);
    const tokenAddressesArray = tuples.map(t => t.tokenAddress);
    const availableRewards = await incentives.getAvailableStakerRewards(
      staker, stakedContractsArray, sponsorsArray, tokenAddressesArray,
    );

    assert.equal(availableRewards.length, tuples.length);
    for (let i = 0; i < tuples.length; i++) {
      const tuple = tuples[i];
      const availableReward = availableRewards[i];
      const rate = rewardRates[tuple.sponsor];
      const expectedReward = stakerNetStake.mul(rate).div(rewardRateScale).toString();
      assert(availableReward.toString(), expectedReward);
    }

    await incentives.claimRewards(
      stakedContractsArray,
      sponsorsArray,
      tokenAddressesArray, {
        from: staker,
      });
    const expectedRewardClaimedAmount =
      Object.values(rewardRates)
        .map(rewardRate => stakerNetStake.mul(rewardRate).div(rewardRateScale))
        .reduce((a, b) => a.add(b), new BN('0'));
    const postRewardBalance = await mockTokenA.balanceOf(staker);

    assert.equal(postRewardBalance.toString(), expectedRewardClaimedAmount.toString());
  });
});
