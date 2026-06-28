'use strict';

const { expect } = require('chai');
const { MAX_TIMER_MS, capTimerMs } = require('./timerMs');

describe('timerMs', () => {
	it('capTimerMs should apply min, default, and max', () => {
		expect(capTimerMs(5000, { min: 1000, default: 15000 })).to.equal(5000);
		expect(capTimerMs(undefined, { min: 1000, default: 15000 })).to.equal(15000);
		expect(capTimerMs(500, { min: 1000, default: 15000 })).to.equal(1000);
		expect(capTimerMs(MAX_TIMER_MS + 1, { min: 0, default: 0 })).to.equal(MAX_TIMER_MS);
	});
});
