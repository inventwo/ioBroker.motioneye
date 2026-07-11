'use strict';

const { expect } = require('chai');
const { bytesToGb, parseCameraDiskUsage } = require('./diskUsage');

describe('diskUsage', () => {
	it('bytesToGb should round to one decimal GB', () => {
		expect(bytesToGb(14.7 * 1024 ** 3)).to.equal(14.7);
		expect(bytesToGb(455.9 * 1024 ** 3)).to.equal(455.9);
	});

	it('parseCameraDiskUsage should map MotionEye disk_used/disk_total', () => {
		const usedBytes = Math.round(14.7 * 1024 ** 3);
		const totalBytes = Math.round(455.9 * 1024 ** 3);
		expect(
			parseCameraDiskUsage({
				disk_used: usedBytes,
				disk_total: totalBytes,
			}),
		).to.deep.equal({
			usedGb: 14.7,
			totalGb: 455.9,
			usedPercent: 3,
		});
	});

	it('parseCameraDiskUsage should return null for missing values', () => {
		expect(parseCameraDiskUsage({})).to.equal(null);
		expect(parseCameraDiskUsage({ disk_used: 1, disk_total: 0 })).to.equal(null);
	});
});
