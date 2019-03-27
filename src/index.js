const MOTD = `
██████╗  █████╗ ████████╗ █████╗  ██████╗ ██████╗  █████╗ ███╗   ███╗
██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗██╔════╝ ██╔══██╗██╔══██╗████╗ ████║
██║  ██║███████║   ██║   ███████║██║  ███╗██████╔╝███████║██╔████╔██║
██║  ██║██╔══██║   ██║   ██╔══██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║
██████╔╝██║  ██║   ██║   ██║  ██║╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
 Resources at datagramjs.com (soon) | Follow project at @machianists
---------------------------------------------------------------------
`

// DEPENDENCIES
const { log } = require('./utils/debug')(__filename)
const { wrapStreamToPAPI, getNested, fromB58, event } = require('./utils')
const promcall = require('promised-callback') //TODO: fix
const sequence = require('async/waterfall')
const fs = require('fs-extra')
const home = require('home')
const init = require('./init')
const API = require('./api')


// HERE LIES DRAGONS
const Datagram = class {
  constructor(
    args = {
      id: null,
      password: null,
      type: null,
      storage: null,
      path: null,
      sharelink: null,
      odi: null,
      realtime: null,
      full_sync: null,
    },
    opts = {
      read: null,
      encryption_password: null,
    }
  ) {
    log('Initializing your datagram...')

    // Internal state
    let _ = {
      ready: false,
      debug: false,
      streams: {},
      type: getNested(args, 'type') ? getNested(args, 'type') : 'redis',
      credentials: {
        id: getNested(args, 'id') || null,
        password: getNested(args, 'password') || null,
      },
      keys: {
        read: getNested(opts, 'read') || null,
        encryption_password: getNested(opts, 'encryption_password') || null,
      },
      settings: {
        storage: getNested(args, 'storage') || null,
        path: getNested(args, 'path') || null,
        odi: getNested(args, 'odi') || null,
        realtime: getNested(args, 'realtime') || null,
        full_sync: getNested(args, 'full_sync') || null,
        host: getNested(args, 'host') || null,
        sharelink: getNested(args, 'sharelink') ? getNested(args, 'sharelink') : null,
      },
    }
    // Public API
    let DG = {
      on: (ev, callback) => event.on(ev, callback),
      debug: () => {
        _.debug = true
        DG._ = _
      },
      destroy: async (callback) => {
          return new Promise(async (resolve, reject) => {
            const { done, error } = promcall(resolve, reject, callback)

            // Note: this works only for local filesystem storage at the moment
            if (typeof _.settings.storage !== 'string') return error(new Error('UNSUPPORTED_STORAGE'))

            const store_key = fromB58(DG.template.DatagramKey).toString('hex')
            try {
              await fs.remove(`${home()}/.datagram/${store_key}`)
            } catch (err) {
              return error(new Error('FS_REMOVE_FAILED'), { err })
            }
            await DG.disconnect()
            _ = undefined
            DG = undefined
            done()
          })
        
      },
    }

    log('Executing initialization sequence...')
    const { generateUserIfNecessary, determineStorage, openOrCreateOrConnect } = { ...init }
    sequence(
      [
        (next) => generateUserIfNecessary(_, next),
        (_, next) => determineStorage(_, next),
        (_, next) => openOrCreateOrConnect(DG, _, next),
        (stream, _, next) => {
          stream = wrapStreamToPAPI({ API, stream, _ })
          next(null, stream)
        },
      ],
      (err, initialized_DG) => {
        if (err) throw err

        // Apply initialized DG and mark initialization done
        DG = initialized_DG
        delete DG.base
        _.ready = true
      },
    )

    DG.ready = async (callback) => {
      return new Promise(async (resolve, reject) => {
        const { done, error } = promcall(resolve, reject, callback)

        const isReady = () => {
          if (_.ready && _.settings.action) {
            log(`Datagram ready, executing action ${_.settings.action}`)
            delete DG.ready
            // TODO: run action
            return done(DG)
          } else if (_.ready && !_.settings.action) {
            log('Datagram ready')
            delete DG.ready
            return done(DG)
          } else {
            setTimeout(isReady, 1)
          }
        }
        setTimeout(isReady, 1)
      })
    }

    // Notifications
    DG.on('connection:new', (pkg) => {
      if(_ && _.debug) console.log(`New connection from ${pkg.socket_key}`)
    })
    DG.on('connection:error', (pkg) => {
      if (_ && _.debug) console.log(`Connection error with ${pkg.socket_key}. Error message: ${JSON.stringify(pkg.error)}`)
    })
    DG.on('connection:end', (pkg) => {
      if (_ && _.debug) console.log(`Connection ended for ${pkg.socket_key}`)
    })

    return DG
  }
}

module.exports = Datagram
