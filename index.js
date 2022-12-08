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
const FAKE_YELLOW = rgb(255, 48, 0) // Not really yellow, but this is what 'looks' yellow on the traffic light.
const YELLOW = rgb(255, 255, 0)
const RED = rgb(255, 0, 0)
const BLACK = rgb(0, 0, 0)
const WHITE = rgb(255, 255, 255)

/**
 * Companion instance class for Traffic Light
 */
class TrafficLightInstance extends instance_skel {

	currentColor = color(0, 0, 0)

	constructor(system, id, config) {
		super(system, id, config)
		this.system = system
		this.config = config
	}

	/**
	 * Triggered on instance being enabled
	 */
	init() {
		this.log('info', 'Traffic light module loaded')
		this.loadWorkspaces()
		this.updateInstance()
		this.updatePresets()
	}

	getHeaders() {
		var basicToken = btoa(`${self.config.apiToken}:api_token`)
		return {
			'Content-Type': 'application/json',
			'Authorization': `Basic ${basicToken}`
		}
	}

	loadWorkspaces() {
		var self = this
		self.status(self.STATUS_WARNING, 'Loading workspaces...')

		var url = 'https://api.track.toggl.com/api/v8/workspaces'
		self.log('info', 'Attempting to load workspaces')
		var cb = (err, result) => {
			if (err !== null) {
				self.log('error', `Error loading workspaces from Toggl (${result.error.code})`);
				self.status(self.STATUS_ERROR, result.error.code);
			} else {
				self.log('info', 'Loaded workspaces successfully')
				self.workspaceChoices = result.data.map(w => {
					'id': w.id,
					'label': w.name
				})
				self.status(self.STATUS_OK);
			}
		}
		self.system.emit('rest_get', host, cb, getHeaders())
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
				id: 'workspace',
				label: 'Workspace',
				choices: self.workspaceChoices
			}
		]
	}

	updateConfig(config) {
		this.log('info', 'Updating config')
		this.config = config;
		this.loadWorkspaces()
	}


	updateInstance() {
		this.log('info', 'Updating instance')
		this.updateActions()
		this.updateFeedbacks()
	}

	updateActions() {
		this.setActions({
			changeColor: {
				label: 'Change Traffic Light Color',
				options: [
					{
						type: 'colorpicker',
						label: 'Color',
						id: 'color',
						default: rgb(0, 0, 0)
					},
				],
				callback: (action) => {
					var self = this
					var url = `http://${self.config.host}:${self.config.port}/color`
					var data = JSON.stringify(rgbToColor(action.options.color))
					self.log('info', `Updating traffic light at ${url} with ${data}`)
					self.system.emit('rest_put', url, data, function (err, result) {
						if (err !== null) {
							self.log('error', `Error updating traffic light (${result.error.code})`);
						} else if (result.response.statusCode !== 200) {
							self.log('error', `Received non-200 response: ${result.response.statusCode} (${result.data})`)
						} else {
							self.log('info', `Updated traffic light successfully: ${JSON.stringify(result.data)}`)
							self.currentColor = result.data
							self.checkFeedbacks('updateBackgroundColor', 'updateAvailableBackgroundColor', 'updateFocusedBackgroundColor', 'updateBusyBackgroundColor')
						}
					})
				}
			},
			getColor: {
				label: 'Get Traffic Light Color',
				options: [],
				callback: (action) => {
					var self = this
					var url = `http://${self.config.host}:${self.config.port}/color`
					self.log('info', `Getting traffic light color at ${url}`)
					self.system.emit('rest_get', url, function (err, result) {
						if (err !== null) {
							self.log('error', `Error getting traffic light color (${result.error.code})`);
						} else if (result.response.statusCode !== 200) {
							self.log('error', `Received non-200 response: ${result.response.statusCode} (${result.data})`)
						} else {
							self.log('info', `Recived current color successfully: ${JSON.stringify(result.data)}`)
							self.currentColor = result.data
							self.checkFeedbacks('updateBackgroundColor')
						}
					})
				}
			}
		})
	}

	updateFeedbacks() {
		this.setFeedbackDefinitions({

			updateBackgroundColor: {
				type: 'advanced',
				label: 'Update Background Color',
				description: 'Updates button background to match current color of traffic light',
				callback: (feedback) => {
					var self = this
					var background = colorToRgb(self.currentColor)
					if (background == FAKE_YELLOW) {
						background = YELLOW
					}

					return {
						bgcolor: background
					}
				}
			},

			updateAvailableBackgroundColor: {
				type: 'advanced',
				label: 'Update Available Background Color',
				destroy: 'Updates button background color to be avaialbe when traffic light shows available',
				callback: (feedback) => {
					var self = this
					if (colorToRgb(self.currentColor) == GREEN) {
						return {
							bgcolor: GREEN
						}
					}
				}
			},

			updateFocusedBackgroundColor: {
				type: 'advanced',
				label: 'Update Focused Background Color',
				destroy: 'Updates button background color to be focused when traffic light shows focused',
				callback: (feedback) => {
					var self = this
					if (colorToRgb(self.currentColor) == FAKE_YELLOW) {
						return {
							bgcolor: YELLOW
						}
					}
				}
			},

			updateBusyBackgroundColor: {
				type: 'advanced',
				label: 'Update Busy Background Color',
				destroy: 'Updates button background color to be busy when traffic light shows busy',
				callback: (feedback) => {
					var self = this
					if (colorToRgb(self.currentColor) == RED) {
						return {
							bgcolor: RED
						}
					}
				}
			}

		})
	}

	updatePresets() {
		const buildTextPreset = (label, text, color, updateBackgroundFb) => {
			return {
				category: 'Commands',
				label: label,
				bank: {
					style: 'text',
					text: text,
					size: '14',
					color: BLACK,
					bgcolor: WHITE
				},
				actions: [
					{
						action: 'changeColor',
						options: {
							color: color
						}
					}
				],
				feedbacks: [{ type: updateBackgroundFb }]
			}
		}

		const buildIconPreset = (label, icon, color) => {
			return {
				category: 'Commands',
				label: label,
				bank: {
					style: 'png',
					png64: icon,
					color: WHITE,
					bgcolor: WHITE
				},
				actions: [
					{
						action: 'changeColor',
						options: {
							color: color
						}
					}
				]
			}
		}


		this.setPresetDefinitions([

			buildIconPreset('Available (Icon)', ICONS.GREEN_LIGHT, GREEN),
			buildIconPreset('Focused (Icon)', ICONS.YELLOW_LIGHT, FAKE_YELLOW),
			buildIconPreset('Busy (Icon)', ICONS.RED_LIGHT, RED),

			{
				category: 'Commands',
				label: 'Status (Icon)',
				bank: {
					style: 'png',
					png64: ICONS.STATUS_LIGHT,
					bgcolor: BLACK
				},
				actions: [{	action: 'getColor' }],
				feedbacks: [{ type: 'updateBackgroundColor'	}]
			},

			{
				category: 'Commands',
				label: 'Off (Icon)',
				bank: {
					style: 'png',
					png64: ICONS.OFF_LIGHT,
					bgcolor: WHITE
				},
				actions: [
					{
						action: 'changeColor',
						options: {
							color: BLACK
						}
					}
				]
			},

			buildTextPreset('Available', 'Available', GREEN, 'updateAvailableBackgroundColor'),
			buildTextPreset('Focused', 'Focused', FAKE_YELLOW, 'updateFocusedBackgroundColor'),
			buildTextPreset('Busy', 'Busy', RED, 'updateBusyBackgroundColor'),

			{
				category: 'Commands',
				label: 'Status',
				bank: {
					style: 'text',
					text: 'Status',
					size: '14',
					color: WHITE,
					bgcolor: BLACK
				},
				actions: [{	action: 'getColor' }],
				feedbacks: [{ type: 'updateBackgroundColor'	}]
			},

			{
				category: 'Commands',
				label: 'Off',
				bank: {
					style: 'text',
					text: 'Off',
					size: '14',
					color: BLACK,
					bgcolor: WHITE
				},
				actions: [
					{
						action: 'changeColor',
						options: {
							color: BLACK
						}
					}
				]
			}

		])
	}

	destroy() {
		this.log('info', `Traffic light module instance destroyed: ${this.id}`)
	}
}

module.exports = TrafficLightInstance
