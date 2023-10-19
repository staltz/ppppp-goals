// @ts-ignore
const Obz = require('obz')
// @ts-ignore
const multicb = require('multicb')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-record').init>} PPPPPRecord
 * @typedef {import('ppppp-db').RecPresent} RecPresent
 * @typedef {import('ppppp-db').Tangle} Tangle
 * @typedef {ReturnType<PPPPPDB['getTangle']>} DBTangle
 * @typedef {string} MsgID
 * @typedef {'none'|'all'|`newest-${number}`|'record'|'set'} GoalDSL
 * @typedef {'none'|'all'|'newest'|'record'|'set'} GoalType
 * @typedef {[number, number]} Range
 * @typedef {{ id: string, type: GoalType, count: number }} Goal
 */

/**
 * @template T
 * @typedef {(...args: [Error] | [null, T]) => void } CB
 */

/**
 * @template T
 * @typedef {(args?: CB<Array<T>>) => any} Multicb
 */

/**
 * A *purpose* is a tag that explains why a msg exists in the database.
 * - "none" means the msg has no purpose, and should not exist in the database.
 * - "ghost" means the msg has no purpose, should not exist in the database, but
 * we should still register it as a ghost so that we don't accidentally
 * re-request it during replication.
 * - "trail" means the msg does not meet any goal, but it is required to be in
 * the database because it is along the path of goalful msgs to the root of the
 * tangle. See "Lipmaa certificate pool" concept from Bamboo.
 * - "goal" means the msg perfectly meets the requirements of some goal.
 *
 * These tags are ordered, "none" < "ghost" < "trail" < "goal", meaning that a
 * msg with purpose "goal" may *also* fulfill the purpose of "trail", and a
 * "trail" also prevents accidental re-request like "ghost" does.
 * @typedef {'none' | 'ghost' | 'trail' | 'goal'} Purpose
 */

/**
 * @param {{ db: PPPPPDB | null }} peer
 * @returns {asserts peer is { db: PPPPPDB }}
 */
function assertDBPlugin(peer) {
  if (!peer.db) throw new Error('goals plugin requires ppppp-db plugin')
}

/**
 * @param {{ record: PPPPPRecord | null }} peer
 * @returns {asserts peer is { record: PPPPPRecord }}
 */
function assertRecordPlugin(peer) {
  if (!peer.record) throw new Error('goals plugin requires ppppp-record plugin')
}

/**
 * @implements {Goal}
 */
class GoalImpl {
  /** @type {string} */
  #id

  /** @type {GoalType} */
  #type

  /** @type {number} */
  #count

  /**
   * @param {string} tangleID
   * @param {GoalDSL} goalDSL
   * @returns
   */
  constructor(tangleID, goalDSL) {
    this.#id = tangleID

    if (goalDSL === 'none') {
      this.#type = 'none'
      this.#count = 0
      return
    }

    if (goalDSL === 'all') {
      this.#type = 'all'
      this.#count = Infinity
      return
    }

    if (goalDSL === 'set') {
      this.#type = 'set'
      this.#count = Infinity
      return
    }

    if (goalDSL === 'record') {
      this.#type = 'record'
      this.#count = Infinity
      return
    }

    const matchN = goalDSL.match(/^newest-(\d+)$/)
    if (matchN) {
      this.#type = 'newest'
      this.#count = Number(matchN[1])
      return
    }

    throw new Error(`Unrecognized goal DSL: ${goalDSL}`)
  }

  get id() {
    return this.#id
  }

  get type() {
    return this.#type
  }

  get count() {
    return this.#count
  }
}

/**
 * @param {{ db: PPPPPDB | null, record: PPPPPRecord | null }} peer
 * @param {unknown} config
 */
function initGoals(peer, config) {
  assertDBPlugin(peer)
  // Constants:
  const EMPTY_RANGE = /** @type {Range} */ ([1, 0])

  // State:
  const goals = /** @type {Map<string, Goal>} */ (new Map())
  const listen = Obz()

  /**
   * @private
   * @param {Goal} goal
   * @param {Tangle} tangle
   * @returns {Range}
   */
  function crossGoalWithTangle(goal, tangle) {
    const maxDepth = tangle.maxDepth
    switch (goal.type) {
      case 'none':
        return EMPTY_RANGE
      case 'all':
      case 'set':
        return [0, maxDepth]
      case 'record':
        assertRecordPlugin(peer)
        const minDepth = peer.record.getMinRequiredDepth(goal.id)
        return [minDepth, maxDepth]
      case 'newest':
        const start = Math.max(0, maxDepth - goal.count + 1)
        return [start, maxDepth]
    }
  }

  /**
   * @public
   * @param {string} tangleID
   * @param {GoalDSL} goalDSL
   * @returns {void}
   */
  function set(tangleID, goalDSL) {
    const goal = new GoalImpl(tangleID, goalDSL)
    goals.set(tangleID, goal)
    listen.set(goal)
  }

  /**
   * @public
   * @param {string} tangleID
   * @returns {Goal | null}
   */
  function get(tangleID) {
    return goals.get(tangleID) ?? null
  }

  /**
   * @public
   * @param {RecPresent} rec
   * @param {CB<Purpose>} cb
   */
  function getRecordPurpose(rec, cb) {
    assertDBPlugin(peer)
    let servesAsTrail = false

    // Check whether this record is a goalful root of some tangle:
    asRoot: if (goals.has(rec.id)) {
      const goal = /** @type {GoalImpl} */ (goals.get(rec.id))
      if (goal.type === 'none') break asRoot
      const tangle = peer.db.getTangle(rec.id)
      if (!tangle) break asRoot
      const [min, max] = crossGoalWithTangle(goal, tangle)
      if (min > max) break asRoot
      if (min === 0) return cb(null, 'goal')
      if (min > 0) servesAsTrail = true
    }

    // Check whether this record is a goalful affix of some tangle:
    const validTangles =
      /** @type {Array<[DBTangle, number, number, number]>} */ ([])
    asAffix: for (const tangleID in rec.msg.metadata.tangles) {
      if (!goals.has(tangleID)) continue asAffix
      const goal = /** @type {GoalImpl} */ (goals.get(tangleID))
      if (goal.type === 'none') continue asAffix
      const tangle = peer.db.getTangle(tangleID)
      if (!tangle) continue asAffix
      const [min, max] = crossGoalWithTangle(goal, tangle)
      if (min > max) continue asAffix
      const recDepth = tangle.getDepth(rec.id)
      if (recDepth < 0) continue asAffix
      validTangles.push([tangle, min, max, recDepth])
    }
    // (Loop over once without heavy computations and maybe return early:)
    for (const [, min, max, recDepth] of validTangles) {
      if (min <= recDepth && recDepth <= max) return cb(null, 'goal')
    }
    // At this point we know that the record *cannot* serve as 'goal',
    // so if it serves as trail, that'll do:
    if (servesAsTrail) return cb(null, 'trail')
    // Check whether this record is a trail affix of some tangle:
    // (Loop again with heavy computations now that it's inevitable:)
    for (const [tangle, min] of validTangles) {
      const minMsgIDs = tangle
        .topoSort()
        .filter((msgID) => tangle.getDepth(msgID) === min)
      const { erasables } = tangle.getDeletablesAndErasables(...minMsgIDs)
      if (erasables.has(rec.id)) return cb(null, 'trail')
    }

    // Check whether this record is a ghost affix of some tangle:
    if (validTangles.length > 0) {
      const done = /** @type {Multicb<Array<MsgID>>} */ (multicb({ pluck: 1 }))
      for (const [tangle] of validTangles) {
        peer.db.ghosts.get(tangle.id, done())
      }
      done((err, allGhosts) => {
        // prettier-ignore
        if (err) return cb(new Error('getRecordPurpose() failed to get ghosts', {cause: err}))
        for (const ghosts of allGhosts) {
          if (ghosts.includes(rec.id)) return cb(null, 'ghost')
        }
        cb(null, 'none')
      })
      return
    }

    cb(null, 'none')
  }

  /**
   * @public
   * @returns {IterableIterator<Goal>}
   */
  function list() {
    return goals.values()
  }

  return {
    set,
    get,
    getRecordPurpose,
    list,
    listen,
  }
}

exports.name = 'goals'
exports.init = initGoals
