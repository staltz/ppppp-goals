const test = require('node:test')
const assert = require('node:assert')
const { isMapIterator } = require('node:util/types')
const p = require('node:util').promisify
const { createPeer } = require('./util')

test('set, getByID, list, listen', async (t) => {
  const alice = createPeer({ name: 'alice' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    domain: 'account',
    _nonce: 'alice',
  })
  const aliceAccountRoot = alice.db.getRecord(aliceID)

  const listened = []
  const stopListening = alice.goals.listen((goal) => {
    listened.push(goal)
  })

  {
    assert.strictEqual(listened.length, 0, 'listened goals is empty')
    alice.goals.set(aliceID, 'newest-5')
    assert('set goal done')
    assert.strictEqual(listened.length, 1, 'listened goals has one')
  }

  {
    const goal = alice.goals.get(aliceID)
    assert.strictEqual(goal.id, aliceID, 'gotten goal id is correct')
    assert.strictEqual(goal.type, 'newest', 'gotten goal type is correct')
    assert.strictEqual(goal.count, 5, 'gotten goal count is correct')
  }

  {
    const purpose = alice.goals.getMsgPurpose(aliceAccountRoot.id, aliceAccountRoot.msg)
    assert.equal(purpose, 'goal', 'rec purpose is "goal"')
  }

  {
    const listed = alice.goals.list()
    assert(isMapIterator(listed), 'list is a map iterator')
    const goals = [...listed]
    assert(Array.isArray(goals), 'listed goals is an array')
    assert.strictEqual(goals.length, 1, 'listed goals has one item')
    const goal = goals[0]
    assert.strictEqual(goal.id, aliceID, 'listed goal id is correct')
  }

  assert.strictEqual(listened.length, 1, 'total listened goals was one')

  assert.strictEqual(
    typeof stopListening,
    'function',
    'stopListening is a function'
  )
  stopListening()

  await p(alice.close)(true)
})

test('getMsgPurpose', async (t) => {
  const alice = createPeer({ name: 'alice' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    domain: 'account',
    _nonce: 'alice',
  })

  const post1 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'm1' },
  })
  const post2 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'm2' },
  })
  const post3 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'post',
    data: { text: 'm3' },
  })

  const feedID = alice.db.feed.getID(aliceID, 'post')

  alice.goals.set(feedID, 'all')
  const gottenGoal = alice.goals.get(feedID)
  assert.strictEqual(gottenGoal.id, feedID, 'gotten goal id is correct')

  const purpose = alice.goals.getMsgPurpose(post2.id, post2.msg)
  assert.equal(purpose, 'goal', 'purpose is "goal"')

  alice.goals.set(feedID, 'newest-1')
  assert('set goal to newest-1')
  const purpose2 = alice.goals.getMsgPurpose(post2.id, post2.msg)
  assert.equal(purpose2, 'none', 'purpose2 is "none"')

  await p(alice.close)(true)
})

test('getMsgPurpose ghost', async (t) => {
  const alice = createPeer({ name: 'alice', record: {ghostSpan: 3} })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    domain: 'account',
    _nonce: 'alice',
  })

  await p(alice.record.load)(aliceID)
  await p(alice.record.update)('profile', { name: 'alice' })
  await p(alice.record.update)('profile', { name: 'Alice' })
  await p(alice.record.update)('profile', { name: 'Alicia' })
  await p(alice.record.update)('profile', { name: 'ALICIA' })
  await p(alice.record.update)('profile', { name: 'ALICIAA' })

  const feedID = alice.record.getFeedID('profile')
  const tangle = alice.db.getTangle(feedID)

  const msgIDs = tangle.topoSort()
  assert.equal(msgIDs.length, 6, 'tangle has root+5 messages')
  const recs = msgIDs.map(id => alice.db.getRecord(id))

  alice.goals.set(feedID, 'record')
  assert.equal(alice.goals.getMsgPurpose(recs[1].id, recs[1].msg), 'none')
  assert.equal(alice.goals.getMsgPurpose(recs[2].id, recs[2].msg), 'ghost')
  assert.equal(alice.goals.getMsgPurpose(recs[3].id, recs[3].msg), 'trail')
  assert.equal(alice.goals.getMsgPurpose(recs[4].id, recs[4].msg), 'trail')
  assert.equal(alice.goals.getMsgPurpose(recs[5].id, recs[5].msg), 'goal')

  await p(alice.close)(true)
})
