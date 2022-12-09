var instance_skel = require('../../instance_skel');
var debug;
var log;

/**
 * @param red 0-255
 * @param green 0-255
 * @param blue 0-255
 * @returns RGB value encoded for Companion Bank styling
 */
const rgb = (red, green, blue) => {
  return ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff)
}

const color = (red, green, blue) => {
  return {
    r: red,
    g: green,
    b: blue
  }
}

const rgbToColor = (rgbVal) => {
  return color((rgbVal >> 16) & 0xff, (rgbVal >> 8) & 0xff, rgbVal & 0xff)
}

const colorToRgb = (color) => {
  return rgb(color.r, color.g, color.b)
}

const GREEN = rgb(0, 255, 0)
const RED = rgb(255, 0, 0)

/**
 * Companion instance class for Traffic Light
 */
class TogglTrackInstance extends instance_skel {

  timerRunning = false
  timerStart = null
  timerProjectId = null
  totalSecondsByProject = {}

  constructor(system, id, config) {
    super(system, id, config)
    this.system = system
    this.config = config
  }

  /**
   * Triggered on instance being enabled
   */
  init() {
    this.log('info', 'Toggle track module loaded')
    this.loadWorkspaces()
    this.updateInstance()
    this.updatePresets()
  }

  getHeaders() {
    var self = this
    var basicToken = Buffer.from(`${self.config.apiToken}:api_token`).toString('base64')
    return {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${basicToken}`
    }
  }

  loadWorkspaces() {
    var self = this
    self.status(self.STATUS_WARNING, 'Loading Workspaces...')

    var url = 'https://api.track.toggl.com/api/v8/workspaces'
    self.log('info', 'Attempting to load workspaces')
    var cb = (err, result) => {
      if (err !== null) {
        self.log('error', `Error loading workspaces from Toggl (${result.error.code})`);
        self.status(self.STATUS_ERROR, result.error.code);
      } else {
        self.log('info', 'Loaded workspaces successfully')
        self.workspaceChoices = result.data.map(w => ({
          'id': w.id,
          'label': w.name
        }))
        self.status(self.STATUS_OK);
      }
    }
    self.system.emit('rest_get', url, cb, self.getHeaders())
  }

  loadProjects() {
    var self = this
    self.status(self.STATUS_WARNING, 'Loading Projects...')

    var url = `https://api.track.toggl.com/api/v9/workspaces/${self.config.workspaceId}/projects`
    self.log('info', `Attempting to load projects for workspace ${self.config.workspaceId}`)
    var cb = (err, result) => {
      if (err !== null) {
        self.log('error', `Error loading projects from Toggl (${result.error.code})`);
        self.status(self.STATUS_ERROR, result.error.code);
      } else {
        self.log('info', 'Loaded projects successfully')
        self.projectChoices = result.data.map(p => ({
          'id': p.id,
          'label': p.name
        }))
        self.status(self.STATUS_OK);
        self.updateInstance()
      }
    }
    self.system.emit('rest_get', url, cb, self.getHeaders())
  }

  getCurrentTimer() {
    var self = this

    var url = 'https://api.track.toggl.com/api/v8/time_entries/current'

    return new Promise((resolve, reject) => {
      self.system.emit('rest_get', url, function (err, result) {
        if (err) {
          self.log('error', 'Error getting current timer: ' + error)
          reject(error)
        } else {
          self.log('debug', `Got current timer: ${JSON.stringify(result.data)}`)
          resolve(result.data.data)
        }
      }, self.getHeaders())
    })
  }

  config_fields() {
    var self = this

    return [
      {
        type: 'textinput',
        id: 'apiToken',
        label: 'Toggl API Token',
        default: ''
      },
      {
        type: 'dropdown',
        id: 'workspaceId',
        label: 'Workspace',
        default: '0',
        choices: self.workspaceChoices
      }
    ]
  }

  updateConfig(config) {
    this.log('info', 'Updating config')
    this.config = config;
    this.loadWorkspaces()
    if (this.config.workspaceId) {
      this.loadProjects()
    }
  }

  updateVariables() {
    var self = this

    this.setVariableDefinitions([
      {
        label: 'Daily Total Hours',
        name: 'dailyTotalHours'
      },
      {
        label: 'Daily Total Minutes',
        name: 'dailyTotalMinutes'
      },
      {
        label: 'Daily Total Seconds',
        name: 'dailyTotalSeconds'
      }
    ])

    self.setVariable('dailyTotalHours', 0)
    self.setVariable('dailyTotalMinutes', 0)
    self.setVariable('dailyTotalSeconds', 0)
  }

  updateInstance() {
    this.log('info', 'Updating instance')
    this.updateVariables()
    this.updateActions()
    this.updateFeedbacks()
  }

  updateActions() {
    var self = this
    this.setActions({

      startTimer: {
        label: 'Start Timer',
        options: [
          {
            type: 'dropdown',
            label: 'Project',
            id: 'projectId',
            choices: self.projectChoices
          },
        ],
        callback: (action) => {
          var self = this
          const opt = action.options

          if (!opt.projectId) {
            self.log('error', 'Project has not been set for timer, will not start')
          }

          var url = 'https://api.track.toggl.com/api/v8/time_entries/start'
          var data = JSON.stringify({
            'time_entry': {
              'created_with': 'companion',
              'description': '',
              'pid': opt.projectId
            }
          })
          self.log('info', `Starting timer ${url} with ${data}`)
          self.system.emit('rest', url, data, function (err, result) {
            if (err !== null) {
              self.log('error', `Error starting timer (${result.error.code})`);
            } else if (result.response.statusCode !== 200) {
              self.log('error', `Received non-200 response: ${result.response.statusCode} (${result.data})`)
            } else {
              self.log('info', `Started timer successfully: ${JSON.stringify(result.data)}`)
              self.timerRunning = true
              self.timerStart = self.getCurrentTimestamp()
            }
          }, self.getHeaders())
        }
      },

      stopTimer: {
        label: 'Stop Timer',
        options: [],
        callback: (action) => {
          var self = this
          self.getCurrentTimer().then((timer) => {
            var url = `https://api.track.toggl.com/api/v8/time_entries/${timer.id}/stop`
            self.log('debug', `Stopping timer: ${url}`)
            self.system.emit('rest_put', url, '', function (err, result) {
              if (err !== null) {
                self.log('error', `Error stopping timer (${result.error.code})`);
              } else if (result.response.statusCode !== 200) {
                self.log('error', `Received non-200 response: ${result.response.statusCode} (${result.data})`)
              } else {
                self.log('info', `Stopped current timer successfully: ${JSON.stringify(result.data)}`)
                self.timerRunning = false
                self.timerStart = null
              }
            }, self.getHeaders())
          })
        }
      },

      refreshDailyTotals: {
        label: 'Refresh Daily Totals',
        callback: (action) => {
          var self = this
          const opt = action.options

          if (!opt.projectId) {
            self.log('error', 'Project has not been set, will not query daily total.')
          }

          var url = `https://api.track.toggl.com/api/v9/me/time_entries?since=${self.getTimestampForToday()}`
          self.log('info', `Getting time entries ${url}`)
          self.system.emit('rest_get', url, function (err, result) {
            if (err !== null) {
              self.log('error', `Error getting time entries (${result.error.code})`);
            } else if (result.response.statusCode !== 200) {
              self.log('error', `Received non-200 response: ${result.response.statusCode} (${result.data})`)
            } else {
              const entries = result.data
              self.log('info', `Retrieved time entries successfully: ${entries.length}`)

              self.totalSecondsByProject = entries.filter(entry => entry.duration > 0).reduce((table, entry) => {
                const key = entry.project_id
                if (!table[key]) {
                  table[key] = 0
                }
                table[key] += entry.duration
                return table
              }, {})

              var openEntry = entries.find(e => e.duration < 0)
              if (openEntry) {
                self.timerRunning = true
                self.timerStart = Math.floor(Date.parse(openEntry.start) / 1000)
                self.timerProjectId = openEntry.project_id
              } else {
                self.timerRunning = false
                self.timerStart = null
                self.timerProjectId = null
              }

              self.updateGeneratedVariables()
            }
          }, self.getHeaders())
        }
      },

      tickCurrentTimer: {
        label: 'Tick Current Timer',
        callback: (action) => {
          var self = this

          self.updateGeneratedVariables()
        }
      }
    })
  }

  updateFeedbacks() {
    var self = this

    this.setFeedbackDefinitions({

      refreshDailyTotals: {
        type: 'advanced',
        label: 'Refresh Daily Totals',
        callback: (feedback) => {
          self.log('info', 'Feedback CB invoked: ' + JSON.stringify(feedback))

          return {}
        }
      }

    })
  }

  updatePresets() {
    this.setPresetDefinitions([

    ])
  }

  destroy() {
    this.log('info', `Toggle track module instance destroyed: ${this.id}`)
  }

  updateGeneratedVariables() {
    var self = this

    for (const projectId in self.totalSecondsByProject) {
      const projectName = self.projectChoices.find(p => p.id === projectId).label
      var totalSeconds = self.totalSecondsByProject[projectId]
      if (self.timerRunning && self.timerProjectId === projectId) {
        totalSeconds += self.getCurrentTimestamp() - self.timerStart
      }

      var hours = Math.floor(totalSeconds / 3600)
      var minutes = Math.floor((totalSeconds % 3600) / 60)
      var seconds = (totalSeconds % 3600) % 60

      self.setVariable(`todayHH_${projectName}`, hours.toString().padStart(2, '0'))
      self.setVariable(`todayMM_${projectName}`, minutes.toString().padStart(2, '0'))
      self.setVariable(`todaySS_${projectName}`, seconds.toString().padStart(2, '0'))
    }
  }

  getTimestampForToday() {
    return new Date().setHours(0, 0, 0, 0) / 1000
  }

  getCurrentTimestamp() {
    return Math.floor(Date.now() / 1000)
  }
}

module.exports = TogglTrackInstance
