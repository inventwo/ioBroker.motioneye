'use strict';

const { expect } = require('chai');
const { describePassword, apiPathLabel, isVerboseLogging, createVerboseLogger } = require('./diagLog');

describe('diagLog', () => {
	it('describePassword should never expose the password', () => {
		expect(describePassword('')).to.equal('not set');
		expect(describePassword('secret123')).to.equal('set (9 chars)');
	});

	it('apiPathLabel should strip query string', () => {
		expect(apiPathLabel('/config/list?_username=admin&_signature=abc')).to.equal('/config/list');
	});

	it('createVerboseLogger should log only when debugging_verbose is enabled', () => {
		const messages = [];
		const log = createVerboseLogger({ debugging_verbose: false }, (level, message) => {
			messages.push({ level, message });
		});
		log('hidden');
		expect(messages).to.have.length(0);

		const logOn = createVerboseLogger({ debugging_verbose: true }, (level, message) => {
			messages.push({ level, message });
		});
		logOn('visible');
		expect(messages).to.deep.equal([{ level: 'info', message: '[verbose] visible' }]);
	});

	it('isVerboseLogging should read debugging_verbose flag', () => {
		expect(isVerboseLogging({ debugging_verbose: true })).to.equal(true);
		expect(isVerboseLogging({ debugging_verbose: false })).to.equal(false);
	});
});
