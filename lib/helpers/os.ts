/**
 * # balenaOS helpers
 *
 * The `BalenaOS` helper class can be used to configure and unpack the OS image that you will use in the test. This allows you to inject config options and network credentials into your image.
 *
 * ```js
 * const network_conf = {
 *    ssid: SSID,
 *    psk: PASSWORD,
 *    nat: true,
 * }
 *
 * const os = new BalenaOS(
 *   {
 *      deviceType: DEVICE_TYPE_SLUG,
 *      network: network_conf,
 *      configJson: {
 *          uuid: UUID,
 *          persistentLogging: true
 *      }
 *   },
 *   this.getLogger()
 * );
 * await os.fetch()
 * await os.configure()
 * ```
 *
 *
 * @module balenaOS helpers
 */

/*
 * Copyright 2017 balena
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import { assignIn, mapValues } from 'lodash';
import { fs } from 'mz';
import { join } from 'path';
import { promisify } from 'util';
import * as Stream from 'stream';
import * as zlib from 'zlib';
const pipeline = promisify(Stream.pipeline);
const imagefs = require('resin-image-fs');
const config = require('config');

async function isGzip(filePath: string) {
	const buf = Buffer.alloc(3);
	await fs.read(await fs.open(filePath, 'r'), buf, 0, 3, 0);
	return buf[0] === 0x1f && buf[1] === 0x8b && buf[2] === 0x08;
}

function id() {
	return `${Math.random()
		.toString(36)
		.substring(2, 10)}`;
}

export class BalenaOS {
	deviceType: string;
	configJson: {};
	image: any;
	network: any;
	logger: any;
	contract: any;
	releaseInfo: any;
	constructor(
		options = {
			deviceType: '',
			network: {},
			image: '',
			configJson: {},
			unpackPath: ''
		},
		logger = { log: console.log, status: console.log, info: console.log },
	) {
		this.deviceType = options.deviceType;
		this.network = options.network;
		this.image = {
			input: options.image || config.get('leviathan.uploads').image,
			path: join(config.get('leviathan.downloads'), `image-${id()}`),
		};
		this.configJson = options.configJson || {};
		this.contract = {
			network: mapValues(this.network, value => {
				return typeof value === 'boolean' ? value : true;
			}),
		};
		this.logger = logger;
		this.releaseInfo = { version: null, variant: null };
	}

	async getDeviceType() {
		console.log(this.deviceType);
	}
	
	async injectBalenaConfiguration(image: string, configuration: any) {
		return imagefs.writeFile(
			{
				image,
				partition: 1,
				path: '/config.json',
			},
			JSON.stringify(configuration),
		);
	};

	// TODO: This function should be implemented using Reconfix
	async injectNetworkConfiguration(image: string, configuration: any) {
		if (configuration.wireless == null) {
			return;
		}
		if (configuration.wireless.ssid == null) {
			throw new Error(
				`Invalid wireless configuration: ${configuration.wireless}`,
			);
		}

		const wifiConfiguration = [
			'[connection]',
			'id=balena-wifi',
			'type=wifi',
			'[wifi]',
			'hidden=true',
			'mode=infrastructure',
			`ssid=${configuration.wireless.ssid}`,
			'[ipv4]',
			'method=auto',
			'[ipv6]',
			'addr-gen-mode=stable-privacy',
			'method=auto',
		];

		if (configuration.wireless.psk) {
			Reflect.apply(wifiConfiguration.push, wifiConfiguration, [
				'[wifi-security]',
				'auth-alg=open',
				'key-mgmt=wpa-psk',
				`psk=${configuration.wireless.psk}`,
			]);
		}

		await imagefs.writeFile(
			{
				image,
				partition: 1,
				path: '/system-connections/balena-wifi',
			},
			wifiConfiguration.join('\n'),
		);
	};

	/**
	 * Prepares the received image/artifact to be used - either unzipping it or moving it to the Leviathan working directory
	 *
	 * @remark Leviathan creates a temporary working directory that can referenced using `config.get('leviathan.downloads')`
	 *
	 * @category helper
	 */
	async fetch() {
		this.logger.log(`Unpacking the file: ${this.image.input}`);
		const unpack = await isGzip(this.image.input);
		if (unpack) {
			await pipeline(
				fs.createReadStream(this.image.input),
				zlib.createGunzip(),
				fs.createWriteStream(this.image.path),
			);
		} else {
			// image is already unzipped, so no need to do anything
			this.image.path = this.image.input;
		}
	}

	/**
	 * Parses version and variant from balenaOS images
	 * @param {string} image
	 *
	 * @category helper
	 */
	async readOsRelease(image = this.image.path) {
		const readVersion = async (pattern: RegExp, field: string) => {
			this.logger.log(`Checking ${field} in os-release`);
			try {
				const value = pattern.exec(
					await imagefs.readFile({
						image: image,
						partition: 1,
						path: '/os-release',
					}),
				);
				if (value !== null) {
					this.releaseInfo[field] = value[1];
					this.logger.log(
						`Found ${field} in os-release file: ${this.releaseInfo[field]}`,
					);
				}
			} catch (e) {
				// If os-release file isn't found, look inside the image to be flashed
				// Especially in case of OS image inside flasher images. Example: Intel-NUC
				try {
					const value1 = pattern.exec(
						await imagefs.readFile({
							image: image,
							partition: 2,
							path: '/usr/lib/os-release',
						}),
					);
					if (value1 !== null) {
						this.releaseInfo[field] = value1[1];
						this.logger.log(
							`Found ${field} in os-release file (flasher image): ${this.releaseInfo[field]}`,
						);
					}
				} catch (err) {
					this.logger.log(
						this.logger.log(`Couldn't find os-release file`)
					);
				}
			}
		};

		await readVersion(/VERSION="(.*)"/g, 'version');
		await readVersion(/VARIANT="(.*)"/g, 'variant');
		assignIn(this.contract, {
			version: this.releaseInfo.version,
			variant: this.releaseInfo.variant,
		});
	}

	addCloudConfig(configJson: any) {
		assignIn(this.configJson, configJson);
	}

	/**
	 * Configures balenaOS image with specifc configuration (if provided), and injects required network configuration
	 *
	 * @category helper
	 */
	async configure() {
		await this.readOsRelease();
		this.logger.log(`Configuring balenaOS image: ${this.image.input}`);
		if (this.configJson) {
			await this.injectBalenaConfiguration(this.image.path, this.configJson);
		}
		await this.injectNetworkConfiguration(this.image.path, this.network);
	}
};
