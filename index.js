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

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(255, 255, 255)
const GREEN = rgb(50, 164, 49)
const RED = rgb(255, 0, 0)

/**
 * Companion instance class for Traffic Light
 */
class TogglTrackInstance extends instance_skel {

  workspaceChoices = []
  projectChoices = []

  timerRunning = false
  timerStart = null
  timerProjectId = null
  dailySecondsByProject = {}
  weeklySecondsByProject = {}

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
        self.checkFeedbacks('refreshDailyTotals')
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

  updateInstance() {
    this.log('info', 'Updating instance')
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
              self.timerProjectId = opt.projectId
              self.checkFeedbacks('updateStartButtonColor', 'updateStopButtonColor', 'refreshDailyTotals')
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
                self.timerProjectId = null
                self.checkFeedbacks('updateStartButtonColor', 'updateStopButtonColor', 'refreshDailyTotals')
              }
            }, self.getHeaders())
          })
        }
      },

      refreshDailyTotals: {
        label: 'Refresh Daily Totals',
        callback: (action) => {
          var self = this
          self.refreshTotals(self.getTimestampForToday(), 'dailySecondsByProject')
        }
      },

      refreshWeeklyTotals: {
        label: 'Refresh Weekly Totals',
        callback: (action) => {
          var self = this
          self.refreshTotals(self.getTimestampForStartOfWeek(), 'weeklySecondsByProject')
        }
      },

      tickCurrentTimer: {
        label: 'Tick Current Timer',
        callback: (action) => {
          var self = this

          self.checkFeedbacks('showWeeklyTotal', 'showDailyTotal')
        }
      }
    })
  }

  updateFeedbacks() {
    var self = this

    this.setFeedbackDefinitions({

      updateStartButtonColor: {
        type: 'advanced',
        label: 'Update Start Button Color',
        callback: (feedback) => {
          var self = this
          var color = BLACK
          if (!self.timerRunning) {
            color = GREEN
          }

          return {
            bgcolor: color
          }
        }
      },

      updateStopButtonColor: {
        type: 'advanced',
        label: 'Update Stop Button Color',
        callback: (feedback) => {
          var self = this
          var color = BLACK
          if (self.timerRunning) {
            color = RED
          }

          return {
            bgcolor: color
          }
        }
      },

      showDailyTotal: {
        type: 'advanced',
        label: 'Show Daily Total for Project',
        options: [
          {
            type: 'dropdown',
            label: 'Project',
            id: 'projectId',
            choices: self.projectChoices
          }
        ],
        callback: (feedback) => {
          var self = this
          const projectId = feedback.options.projectId
          const totalSeconds = self.getRunningTotal(projectId, self.dailySecondsByProject)

          return {
            text: self.totalSecondsToHMS(totalSeconds)
          }
        }
      },

      showWeeklyTotal: {
        type: 'advanced',
        label: 'Show Weekly Total for Project',
        options: [
          {
            type: 'dropdown',
            label: 'Project',
            id: 'projectId',
            choices: self.projectChoices
          }
        ],
        callback: (feedback) => {
          var self = this
          const projectId = feedback.options.projectId
          const totalSeconds = self.getRunningTotal(projectId, self.weeklySecondsByProject)

          return {
            text: self.totalSecondsToHMS(totalSeconds)
          }
        }
      }


    })
  }

  getRunningTotal(projectId, table) {
    var self = this
    var totalSeconds = table[projectId] || 0
    if (self.timerRunning && self.timerProjectId == projectId) {
      totalSeconds += self.getCurrentTimestamp() - self.timerStart
    }
    return totalSeconds
  }

  totalSecondsToHMS(totalSeconds) {
    var hours = Math.floor(totalSeconds / 3600)
    var minutes = Math.floor((totalSeconds % 3600) / 60)
    var seconds = (totalSeconds % 3600) % 60

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  refreshTotals(startTimestamp, tableName) {
    var self = this
    var url = `https://api.track.toggl.com/api/v9/me/time_entries?since=${startTimestamp}`
    self.log('info', `Getting time entries ${url}`)
    self.system.emit('rest_get', url, function (err, result) {
      if (err !== null) {
        self.log('error', `Error getting time entries (${result.error.code})`);
      } else if (result.response.statusCode !== 200) {
        self.log('error', `Received non-200 response: ${result.response.statusCode} (${result.data})`)
      } else {
        const entries = result.data
        self.log('info', `Retrieved time entries successfully: ${entries.length}`)

        self[tableName] = entries.filter(entry => entry.duration > 0).reduce((table, entry) => {
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
      }
    }, self.getHeaders())
  }

  updatePresets() {
    this.setPresetDefinitions([

      {
        category: 'Commands',
        label: 'Start Timer (AWS)',
        bank: {
          style: 'text',
          text: 'Clock In',
          size: '14',
          color: WHITE,
          bgcolor: BLACK
        },
        actions: [
          {
            action: 'startTimer',
            options: {
              projectId: '187813183'
            }
          },
          { action: 'refreshDailyTotals' },
          { action: 'refreshWeeklyTotals' }

        ],
        feedbacks: [
          {
            type: 'updateStartButtonColor'
          }
        ]
      },

      {
        category: 'Commands',
        label: 'Stop Timer',
        bank: {
          style: 'text',
          text: 'Clock Out',
          size: '14',
          color: WHITE,
          bgcolor: BLACK
        },
        actions: [
          { action: 'stopTimer' },
          { action: 'refreshDailyTotals' },
          { action: 'refreshWeeklyTotals' }
        ],
        feedbacks: [
          { type: 'updateStopButtonColor' }
        ]
      },

      {
        category: 'HUD',
        label: 'Daily Total',
        bank: {
          style: 'text',
          text: '00:00:00',
          size: '14',
          color: WHITE,
          bgcolor: BLACK
        },
        actions: [
          { action: 'refreshDailyTotals' }
        ],
        feedbacks: [
          {
            type: 'showDailyTotal',
            options: {
              projectId: '187813183'
            }
          }
        ]
      },

      {
        category: 'HUD',
        label: 'Weekly Total',
        bank: {
          style: 'text',
          text: '00:00:00',
          size: '14',
          color: WHITE,
          bgcolor: BLACK
        },
        actions: [
          { action: 'refreshWeeklyTotals' }
        ],
        feedbacks: [
          {
            type: 'showWeeklyTotal',
            options: {
              projectId: '187813183'
            }
          }
        ]
      }

    ])
  }

  destroy() {
    this.log('info', `Toggle track module instance destroyed: ${this.id}`)
  }

  getTimestampForToday() {
    return new Date().setHours(0, 0, 0, 0) / 1000
  }

  getTimestampForStartOfWeek() {
    var dayOfWeekIdx = new Date().getDay()
    var timestampForToday = this.getTimestampForToday()
    return timestampForToday - ((dayOfWeekIdx - 1) * 60 * 60 * 24)
  }

  getCurrentTimestamp() {
    return Math.floor(Date.now() / 1000)
  }
}

module.exports = TogglTrackInstance
