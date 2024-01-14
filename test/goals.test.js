const test = require('node:test')
const assert = require('node:assert')
const { isMapIterator } = require('node:util/types')
const p = require('node:util').promisify
const { createPeer } = require('./util')

test('parse() and serialize()', async (t) => {
  const peer = createPeer({ name: 'alice' })
  await peer.db.loaded()

  const all = peer.goals.parse('all')
  assert.equal(all.type, 'all')
  assert.equal(all.count, Infinity)

  const newest = peer.goals.parse('newest-123')
  assert.equal(newest.type, 'newest')
  assert.equal(newest.count, 123)

  assert.equal(peer.goals.serialize(all), 'all')
  assert.equal(peer.goals.serialize(newest), 'newest-123')

  await p(setTimeout)(200) // necessary wait, otherwise peer.close fails
  await p(peer.close)(true)
})

test('set, getByID, list, watch', async (t) => {
  const alice = createPeer({ name: 'alice' })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })
  const aliceAccountRoot = alice.db.getRecord(aliceID)

  const watched = []
  const stopListening = alice.goals.watch((goal) => {
    watched.push(goal)
  })

  {
    assert.strictEqual(watched.length, 0, 'watched goals is empty')
    alice.goals.set(aliceID, 'newest-5')
    assert('set goal done')
    assert.strictEqual(watched.length, 1, 'watched goals has one')
  }

  {
    const goal = alice.goals.get(aliceID)
    assert.strictEqual(goal.id, aliceID, 'gotten goal id is correct')
    assert.strictEqual(goal.type, 'newest', 'gotten goal type is correct')
    assert.strictEqual(goal.count, 5, 'gotten goal count is correct')
  }

  {
    const [purpose] = alice.goals.getMsgPurpose(
      aliceAccountRoot.id,
      aliceAccountRoot.msg
    )
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

  assert.strictEqual(watched.length, 1, 'total watched goals was one')

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
    subdomain: 'account',
    _nonce: 'alice',
  })

  const post1 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'posts',
    data: { text: 'm1' },
  })
  const post2 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'posts',
    data: { text: 'm2' },
  })
  const post3 = await p(alice.db.feed.publish)({
    account: aliceID,
    domain: 'posts',
    data: { text: 'm3' },
  })

  const feedID = alice.db.feed.getID(aliceID, 'posts')

  alice.goals.set(feedID, 'all')
  const gottenGoal = alice.goals.get(feedID)
  assert.strictEqual(gottenGoal.id, feedID, 'gotten goal id is correct')

  const [purpose] = alice.goals.getMsgPurpose(post2.id, post2.msg)
  assert.equal(purpose, 'goal', 'purpose is "goal"')

  alice.goals.set(feedID, 'newest-1')
  assert('set goal to newest-1')
  const [purpose2] = alice.goals.getMsgPurpose(post2.id, post2.msg)
  assert.equal(purpose2, 'none', 'purpose2 is "none"')

  await p(alice.close)(true)
})

test('getMsgPurpose ghost', async (t) => {
  const alice = createPeer({ name: 'alice', dict: { ghostSpan: 3 } })

  await alice.db.loaded()
  const aliceID = await p(alice.db.account.create)({
    subdomain: 'account',
    _nonce: 'alice',
  })

  await p(alice.dict.load)(aliceID)
  await p(alice.dict.update)('profile', { name: 'alice' })
  await p(alice.dict.update)('profile', { name: 'Alice' })
  await p(alice.dict.update)('profile', { name: 'Alicia' })
  await p(alice.dict.update)('profile', { name: 'ALICIA' })
  await p(alice.dict.update)('profile', { name: 'ALICIAA' })

  const feedID = alice.dict.getFeedID('profile')
  const tangle = alice.db.getTangle(feedID)

  const msgIDs = tangle.topoSort()
  assert.equal(msgIDs.length, 6, 'tangle has root+5 messages')
  const recs = msgIDs.map((id) => alice.db.getRecord(id))

  alice.goals.set(feedID, 'dict')
  assert.equal(alice.goals.getMsgPurpose(recs[1].id, recs[1].msg)[0], 'none')
  assert.equal(alice.goals.getMsgPurpose(recs[2].id, recs[2].msg)[0], 'ghost')
  assert.equal(alice.goals.getMsgPurpose(recs[3].id, recs[3].msg)[0], 'trail')
  assert.equal(alice.goals.getMsgPurpose(recs[4].id, recs[4].msg)[0], 'trail')
  assert.equal(alice.goals.getMsgPurpose(recs[5].id, recs[5].msg)[0], 'goal')

  const [purpose, details] = alice.goals.getMsgPurpose(recs[2].id, recs[2].msg)
  assert.equal(purpose, 'ghost')
  assert.deepEqual(details, { tangleID: feedID, span: 3 })

  await p(alice.close)(true)
})
