// @ts-ignore
const Obz = require('obz')

/**
 * @typedef {ReturnType<import('ppppp-db').init>} PPPPPDB
 * @typedef {ReturnType<import('ppppp-dict').init>} PPPPPDict
 * @typedef {ReturnType<import('ppppp-set').init>} PPPPPSet
 * @typedef {import('ppppp-db').RecPresent} RecPresent
 * @typedef {import('ppppp-db').Tangle} Tangle
 * @typedef {import('ppppp-db').Msg} Msg
 * @typedef {ReturnType<PPPPPDB['getTangle']>} DBTangle
 * @typedef {string} MsgID
 * @typedef {'none'|'all'|`newest-${number}`|'dict'|'set'} GoalDSL
 * @typedef {'none'|'all'|'newest'|'dict'|'set'} GoalType
 * @typedef {[number, number]} Range
 * @typedef {{ id: string, type: GoalType, count: number }} Goal
 * @typedef {{ tangleID: MsgID, span: number }} GhostDetails
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
 * @typedef {['none']
 *         | ['ghost', GhostDetails]
 *         | ['trail']
 *         | ['goal']
 * } PurposeWithDetails
 */

/**
 * @param {{ db: PPPPPDB | null }} peer
 * @returns {asserts peer is { db: PPPPPDB }}
 */
function assertDBPlugin(peer) {
  if (!peer.db) throw new Error('"goals" plugin requires "db" plugin')
}

/**
 * @param {{ dict: PPPPPDict | null }} peer
 * @returns {asserts peer is { dict: PPPPPDict }}
 */
function assertDictPlugin(peer) {
  if (!peer.dict) throw new Error('"goals" plugin requires "dict" plugin')
}

/**
 * @param {{ set: PPPPPSet | null }} peer
 * @returns {asserts peer is { set: PPPPPSet }}
 */
function assertSetPlugin(peer) {
  if (!peer.set) throw new Error('"goals" plugin requires "set" plugin')
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

    if (goalDSL === 'dict') {
      this.#type = 'dict'
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
 * @param {{ db: PPPPPDB | null, dict: PPPPPDict | null, set: PPPPPSet | null }} peer
 * @param {unknown} config
 */
function initGoals(peer, config) {
  assertDBPlugin(peer)
  // Constants:
  const EMPTY_RANGE = /** @type {Range} */ ([1, 0])

  // State:
  const goals = /** @type {Map<string, Goal>} */ (new Map())
  const watch = Obz()

  /**
   * @private
   * @param {Goal} goal
   * @param {Tangle} tangle
   * @returns {Range}
   */
  function crossGoalWithTangle(goal, tangle) {
    const maxDepth = tangle.maxDepth
    switch (goal.type) {
      case 'newest':
        const start = Math.max(0, maxDepth - goal.count + 1)
        return [start, maxDepth]

      case 'all':
        return [0, maxDepth]

      case 'set':
        assertSetPlugin(peer)
        const minSetDepth = peer.set.minRequiredDepth(goal.id)
        return [minSetDepth, maxDepth]

      case 'dict':
        assertDictPlugin(peer)
        const minDictDepth = peer.dict.minRequiredDepth(goal.id)
        return [minDictDepth, maxDepth]

      case 'none':
        return EMPTY_RANGE

      default:
        throw new Error(`Unrecognized goal type: ${goal.type}`)
    }
  }

  /**
   * @public
   * @param {GoalDSL} goalDSL
   * @returns {Goal}
   */
  function parse(goalDSL) {
    return new GoalImpl('?', goalDSL)
  }

  /**
   * @param {Pick<Goal, 'type' | 'count'>} goal
   * @returns {GoalDSL}
   */
  function serialize(goal) {
    switch (goal.type) {
      case 'newest':
        return `newest-${goal.count}`
      case 'all':
        return 'all'
      case 'set':
        return 'set'
      case 'dict':
        return 'dict'
      case 'none':
        return 'none'
      default:
        throw new Error(`Unrecognized goal type: ${goal.type}`)
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
    watch.set(goal)
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
   * @param {MsgID} msgID
   * @param {Msg} msg
   * @returns {PurposeWithDetails}
   */
  function getMsgPurpose(msgID, msg) {
    assertDBPlugin(peer)
    let servesAsTrail = false

    // Check whether this msg is a goalful root of some tangle:
    asRoot: if (goals.has(msgID)) {
      const goal = /** @type {GoalImpl} */ (goals.get(msgID))
      if (goal.type === 'none') break asRoot
      const tangle = peer.db.getTangle(msgID)
      if (!tangle) break asRoot
      const [min, max] = crossGoalWithTangle(goal, tangle)
      if (min > max) break asRoot
      if (min === 0) return ['goal']
      if (min > 0) servesAsTrail = true
    }

    // Check whether this msg is a goalful affix of some tangle:
    const validTangles =
      /** @type {Array<[DBTangle, number, number, number, GoalType]>} */ ([])
    asAffix: for (const tangleID in msg.metadata.tangles) {
      if (!goals.has(tangleID)) continue asAffix
      const goal = /** @type {GoalImpl} */ (goals.get(tangleID))
      if (goal.type === 'none') continue asAffix
      const tangle = peer.db.getTangle(tangleID)
      if (!tangle) continue asAffix
      const [min, max] = crossGoalWithTangle(goal, tangle)
      if (min > max) continue asAffix
      const recDepth = tangle.getDepth(msgID)
      if (recDepth < 0) continue asAffix
      validTangles.push([tangle, min, max, recDepth, goal.type])
    }
    // (Loop over once without heavy computations and maybe return early:)
    for (const [, min, max, recDepth] of validTangles) {
      if (min <= recDepth && recDepth <= max) return ['goal']
    }
    // At this point we know that the msg *cannot* serve as 'goal',
    // so if it serves as trail, that'll do:
    if (servesAsTrail) return ['trail']
    // Check whether this msg is a trail affix of some tangle:
    // (Loop again with heavy computations now that it's inevitable:)
    for (const [tangle, min] of validTangles) {
      const minMsgIDs = tangle
        .topoSort()
        .filter((msgID) => tangle.getDepth(msgID) === min)
      const { erasables } = tangle.getDeletablesAndErasables(...minMsgIDs)
      if (erasables.has(msgID)) return ['trail']
    }

    // Check whether this msg is a ghost affix of some tangle:
    for (const [tangle, , , , goalType] of validTangles) {
      if (goalType === 'dict') {
        assertDictPlugin(peer)
        const span = peer.dict.getGhostSpan()
        if (peer.dict.isGhostable(msgID, tangle.id)) {
          return ['ghost', { tangleID: tangle.id, span }]
        }
      }
      if (goalType === 'set') {
        assertSetPlugin(peer)
        const span = peer.set.getGhostSpan()
        if (peer.set.isGhostable(msgID, tangle.id)) {
          return ['ghost', { tangleID: tangle.id, span }]
        }
      }
    }

    return ['none']
  }

  /**
   * @public
   * @returns {IterableIterator<Goal>}
   */
  function list() {
    return goals.values()
  }

  return {
    parse,
    serialize,
    set,
    get,
    getMsgPurpose,
    list,
    watch,
  }
}

exports.name = 'goals'
exports.init = initGoals
