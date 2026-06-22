'use strict';

const { expect } = require('chai');
const {
	MOTIONEYE_MEDIA_BASE,
	sanitizeMediaFolderName,
	buildMediaRootDirectory,
	buildStoragePatch,
} = require('./mediaStorage');

describe('mediaStorage', () => {
	it('sanitizeMediaFolderName should reject path separators', () => {
		expect(sanitizeMediaFolderName('Bambu')).to.equal('Bambu');
		expect(sanitizeMediaFolderName('Innenhof I')).to.equal('Innenhof I');
		expect(sanitizeMediaFolderName('/var/lib/foo')).to.equal('');
		expect(sanitizeMediaFolderName('..')).to.equal('');
	});

	it('buildMediaRootDirectory should prepend MotionEye base path', () => {
		expect(buildMediaRootDirectory('Bambu')).to.equal(`${MOTIONEYE_MEDIA_BASE}/Bambu`);
		expect(buildMediaRootDirectory('')).to.equal('');
	});

	it('buildStoragePatch should return custom-path config', () => {
		expect(buildStoragePatch('Carport')).to.deep.equal({
			storage_device: 'custom-path',
			root_directory: `${MOTIONEYE_MEDIA_BASE}/Carport`,
		});
		expect(buildStoragePatch('')).to.deep.equal({});
	});
});
