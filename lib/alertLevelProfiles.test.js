'use strict';

const { expect } = require('chai');
const {
	normalizeAlertLevel,
	getAlertLevelProfile,
	inferAlertLevel,
} = require('./alertLevelProfiles');

describe('alertLevelProfiles', () => {
	it('normalizeAlertLevel should accept aliases', () => {
		expect(normalizeAlertLevel('notify')).to.equal('notify');
		expect(normalizeAlertLevel('Alarm')).to.equal('notify');
		expect(normalizeAlertLevel('2')).to.equal('notify');
		expect(normalizeAlertLevel('vollschutz')).to.equal('full');
		expect(normalizeAlertLevel('invalid')).to.equal(null);
	});

	it('getAlertLevelProfile should map levels to mode and telegram', () => {
		expect(getAlertLevelProfile('motion')).to.deep.equal({ mode: 'still', telegramOnMotion: false });
		expect(getAlertLevelProfile('notify')).to.deep.equal({ mode: 'still', telegramOnMotion: true });
		expect(getAlertLevelProfile('record')).to.deep.equal({ mode: 'sharp', telegramOnMotion: false });
		expect(getAlertLevelProfile('full')).to.deep.equal({ mode: 'sharp', telegramOnMotion: true });
		expect(getAlertLevelProfile('off')).to.deep.equal({ mode: 'off', telegramOnMotion: false });
	});

	it('inferAlertLevel should round-trip profile combinations', () => {
		expect(inferAlertLevel('off', true)).to.equal('off');
		expect(inferAlertLevel('still', false)).to.equal('motion');
		expect(inferAlertLevel('still', true)).to.equal('notify');
		expect(inferAlertLevel('sharp', false)).to.equal('record');
		expect(inferAlertLevel('sharp', true)).to.equal('full');
	});
});
