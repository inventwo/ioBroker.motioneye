'use strict';

const { expect } = require('chai');
const { parseSizeStrToBytes, summarizeMediaList, bytesToMb } = require('./mediaUsage');

describe('mediaUsage', () => {
	it('parseSizeStrToBytes should parse all MotionEye pretty_size units', () => {
		expect(parseSizeStrToBytes('512.0 B')).to.equal(512);
		expect(parseSizeStrToBytes('1.0 kB')).to.equal(1024);
		expect(parseSizeStrToBytes('1.2 MB')).to.equal(Math.round(1.2 * 1024 * 1024));
		expect(parseSizeStrToBytes('2.5 GB')).to.equal(Math.round(2.5 * 1024 * 1024 * 1024));
	});

	it('parseSizeStrToBytes should be case-insensitive on the unit', () => {
		expect(parseSizeStrToBytes('1.0 kb')).to.equal(1024);
		expect(parseSizeStrToBytes('1.0 KB')).to.equal(1024);
	});

	it('parseSizeStrToBytes should return 0 for missing/unparseable values', () => {
		expect(parseSizeStrToBytes(undefined)).to.equal(0);
		expect(parseSizeStrToBytes('')).to.equal(0);
		expect(parseSizeStrToBytes('n/a')).to.equal(0);
	});

	it('summarizeMediaList should count entries and sum sizes', () => {
		const list = [{ sizeStr: '1.0 kB' }, { sizeStr: '1.0 kB' }, { sizeStr: '2.0 MB' }];
		expect(summarizeMediaList(list)).to.deep.equal({
			count: 3,
			totalBytes: 1024 + 1024 + 2 * 1024 * 1024,
		});
	});

	it('summarizeMediaList should handle empty/non-array input', () => {
		expect(summarizeMediaList([])).to.deep.equal({ count: 0, totalBytes: 0 });
		expect(summarizeMediaList(null)).to.deep.equal({ count: 0, totalBytes: 0 });
		expect(summarizeMediaList(undefined)).to.deep.equal({ count: 0, totalBytes: 0 });
	});

	it('bytesToMb should round to 1 decimal', () => {
		expect(bytesToMb(1024 * 1024)).to.equal(1);
		expect(bytesToMb(1.25 * 1024 * 1024)).to.equal(1.3);
		expect(bytesToMb(0)).to.equal(0);
	});
});
