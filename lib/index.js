// @ts-ignore
const Obz = require('obz')

/**
 * @typedef {import('ppppp-db/msg-v3').RecPresent} RecPresent
 *
 * @typedef {'all'} GoalAll
 * @typedef {`newest-${number}`} GoalNewest
 * @typedef {`oldest-${number}`} GoalOldest
 * @typedef {GoalAll|GoalNewest|GoalOldest} GoalDSL
 */

class Goal {
  /** @type {string} */
  #id

  /** @type {'all' | 'newest' | 'oldest'} */
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
    if (goalDSL === 'all') {
      this.#type = 'all'
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
    /** @type {Map<string, Goal>} */
    const goals = new Map()
    const listen = Obz()

    /**
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
            arr.push(goal)
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
