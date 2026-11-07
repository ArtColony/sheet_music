import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, text, psLiteral } from '../src/ps.js';
import { psValues, noPscat as skip } from './pscat-run.mjs';

test('num: two decimals, no trailing zeros, no -0', () => {
  assert.equal(num(0), '0');
  assert.equal(num(-0.001), '0');
  assert.equal(num(1.5), '1.5');
  assert.equal(num(1.505), '1.51');
  assert.equal(num(-12.3456), '-12.35');
  assert.equal(num(100), '100');
  assert.equal(num(0.07), '0.07');
});

test('text: ASCII, escapes and composed accents', () => {
  assert.equal(text('a(b)c\\'), '(a\\(b\\)c\\\\)');
  assert.equal(text("it's"), '(it\\047s)');
  assert.equal(text('café', 10), '[(caf) [(e) (\\302) 0]]');
  assert.equal(text('É', 10), '[[(E) (\\302) 2.2]]');
  assert.equal(text('ße—x'), '(\\373e\\320x)');
  assert.equal(text('漢'), '(?)');
});

test('xml parser (lib/sm_musicxml.ps): entities, attributes, CDATA, comments, doctype', { skip }, () => {
  const [d] = psValues([`${psLiteral('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><!-- c --><a k="1&amp;2"><b>x &lt; y</b><![CDATA[<raw>]]><c/></a>')} sm-mxp-dict begin sm-mxp-xml end`]);
  const a = d.children[0];
  assert.equal(a.attrs.k, '1&2');
  assert.equal(a.children[0].text, 'x < y');
  assert.equal(a.text, '<raw>');
  assert.equal(a.children[1].name, 'c');
});

test('musicxml sample (sm-musicxml-parse): lyrics, harmony, beams, tempo, system break', { skip }, () => {
  const [score, warnings] = psValues(['(samples/frere-jacques.musicxml) sm-musicxml-parse-file', 'sm-musicxml-warnings']);
  assert.deepEqual(warnings, []);
  assert.equal(score.meta.title, 'Frère Jacques');
  assert.equal(score.measures.length, 8);
  const first = score.measures[0].staves[0].events[0];
  assert.equal(first.lyrics[0].text, 'Frè');
  assert.equal(first.lyrics[0].hyphen, true);
  assert.equal(first.chord, 'C');
  assert.equal(score.measures[3].lineBreak, true);
  assert.equal(score.tempo.bpm, 104);
  assert.equal(score.measures[4].staves[0].events[1].beam, true);
  assert.equal(score.measures[7].endBar, 'final');
});
