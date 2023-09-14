// @ts-ignore
const Obz = require('obz')

/**
 * @typedef {import('ppppp-db').RecPresent} RecPresent
 * @typedef {import('ppppp-db').Tangle} Tangle
 * @typedef {'none'|'all'|`newest-${number}`|`oldest-${number}`|'record'|'set'} GoalDSL
 * @typedef {[number, number]} Range
 */

class Goal {
  /** @type {string} */
  #id

  /** @type {'none' | 'all' | 'set' | 'record' | 'newest' | 'oldest'} */
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

    const matchO = goalDSL.match(/^oldest-(\d+)$/)
    if (matchO) {
      this.#type = 'oldest'
      this.#count = Number(matchO[1])
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

module.exports = {
  name: 'goals',
  manifest: {},
  permissions: {
    anonymous: {},
  },

  /**
   * @param {any} peer
   * @param {{ path: string; keypair: Keypair; }} config
   */
  init(peer, config) {
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
        case 'record':
          return [0, maxDepth]
        case 'newest':
          const start = Math.max(0, maxDepth - goal.count + 1)
          return [start, maxDepth]
        case 'oldest':
          const end = Math.min(maxDepth, goal.count - 1)
          return [0, end]
      }
    }

    /**
     * @public
     * @param {string} tangleID
     * @param {GoalDSL} goalDSL
     * @returns {void}
     */
    function set(tangleID, goalDSL) {
      const goal = new Goal(tangleID, goalDSL)
      goals.set(tangleID, goal)
      listen.set(goal)
    }

    /**
     * @public
     * @param {string} msgID
     * @returns {Goal | null}
     */
    function getByID(msgID) {
      return goals.get(msgID) ?? null
    }

    /**
     * @public
     * @param {RecPresent} rec
     * @returns {Array<Goal>}
     */
    function getByRec(rec) {
      const arr = []
      if (goals.has(rec.id)) {
        const goal = /** @type {Goal} */ (goals.get(rec.id))
        arr.push(goal)
      }
      if (rec.msg) {
        for (const tangleID in rec.msg.metadata.tangles) {
          if (goals.has(tangleID)) {
            const goal = /** @type {Goal} */ (goals.get(tangleID))
            const tangle = peer.db.getTangle(tangleID)
            if (tangle) {
              const [min, max] = crossGoalWithTangle(goal, tangle)
              const depth = tangle.getDepth(rec.id)
              if (depth >= 0 && min <= depth && depth <= max) arr.push(goal)
            }
          }
        }
      }
      return arr
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
      getByID,
      getByRec,
      list,
      listen,
    }
  },
}
