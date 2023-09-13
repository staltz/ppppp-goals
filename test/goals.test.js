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
    const goal = alice.goals.getByID(aliceID)
    assert.strictEqual(goal.id, aliceID, 'gotten goal id is correct')
    assert.strictEqual(goal.type, 'newest', 'gotten goal type is correct')
    assert.strictEqual(goal.count, 5, 'gotten goal count is correct')
  }

  {
    const goals = alice.goals.getByRec(aliceAccountRoot)
    assert(Array.isArray(goals), 'gotten rec goals is an array')
    assert.strictEqual(goals.length, 1, 'gotten rec goals has one item')
    const goal = goals[0]
    assert.strictEqual(goal.id, aliceID, 'gotten rec goal id is correct')
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

test('getByRec', async (t) => {
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

  const feedID = alice.db.feed.getID(aliceID, 'post')

  alice.goals.set(feedID, 'all')
  const gottenGoal = alice.goals.getByID(feedID)
  assert.strictEqual(gottenGoal.id, feedID, 'gotten goal id is correct')

  const recGoals = alice.goals.getByRec(post2)
  assert(Array.isArray(recGoals), 'recGoals is an array')
  assert.strictEqual(recGoals.length, 1, 'recGoals has one item')
  const recGoal = recGoals[0]
  assert.strictEqual(recGoal.id, feedID, 'recGoal id is correct')

  alice.goals.set(feedID, 'oldest-1')
  assert('set goal to oldest-1')
  const recGoals2 = alice.goals.getByRec(post2)
  assert(Array.isArray(recGoals2), 'recGoals is an array')
  assert.strictEqual(recGoals2.length, 0, 'recGoals2 has zero items')

  await p(alice.close)(true)
})
