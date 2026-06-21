'use strict';

const { expect } = require('chai');
const { buildStreamHtml, buildStreamSrc } = require('./streamManager');

describe('streamManager HTML', () => {
	it('buildStreamSrc should use streaming_port or fallback 9080+id', () => {
		expect(buildStreamSrc('192.168.1.1', 2, { streaming_port: 9092 }, 123)).to.equal(
			'http://192.168.1.1:9092/?t=123',
		);
		expect(buildStreamSrc('192.168.1.1', 2, {}, undefined)).to.equal('http://192.168.1.1:9082/');
	});

	it('buildStreamHtml should return img tag with cache bust', () => {
		const html = buildStreamHtml('192.168.1.1', 1, { streaming_port: 9081 }, 999);
		expect(html).to.include('<img src="http://192.168.1.1:9081/?t=999"');
		expect(html).to.include('onerror=');
	});
});
