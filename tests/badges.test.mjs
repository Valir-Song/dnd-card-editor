import test from 'node:test';
import assert from 'node:assert/strict';
import { addBadge, removeBadge, setBadgeText, setBadgeColor, badgeList, nextBadgeSpot, SYMBOLS, COLORS, canHaveBadges } from '../src/editor/badges.js';

const card=(extra={})=>({id:'c',kind:'card',page:1,x:0,y:0,w:91,h:23,...extra});

test('the first badge is the main one (level), the next ones go beside it',()=>{
  const c=card();
  assert.equal(addBadge(c),null);
  assert.equal(c.level,'1');
  assert.equal(addBadge(c),0);
  assert.equal(addBadge(c,'К'),1);
  assert.deepEqual(c.badges.map(b=>[b.text,b.x,b.y]),[['★',74,15],['К',65,15]],'right to left along the bottom');
  assert.deepEqual(badgeList(c).map(b=>[b.index,b.text]),[[null,'1'],[0,'★'],[1,'К']]);
});

test('a full row continues one row higher and never leaves the card',()=>{
  const small=card({w:20,h:20,level:'1',badges:[{text:'a',x:0,y:0}]});
  assert.deepEqual(nextBadgeSpot(small),{x:12,y:3},'two badges fit a 20 mm row: the third goes up');
  const tiny=card({w:5,h:5,level:'1'});
  assert.deepEqual(nextBadgeSpot(tiny),{x:0,y:0});
});

test('text, colour and removal work on the main badge and on the others',()=>{
  const c=card({level:'2',badgeX:10,badgeY:5,badgeCustomPosition:true,badges:[{text:'★',x:1,y:1},{text:'☾',x:2,y:2}]});
  setBadgeText(c,null,'♪'); setBadgeText(c,1,'⚔');
  setBadgeColor(c,null,'#b23a3a'); setBadgeColor(c,0,'#3d7a37'); setBadgeColor(c,0,'');
  assert.equal(c.level,'♪'); assert.equal(c.badges[1].text,'⚔');
  assert.equal(c.badgeColor,'#b23a3a'); assert.ok(!('color' in c.badges[0]),'«Как в теме» removes the colour');
  removeBadge(c,0);
  assert.deepEqual(c.badges.map(b=>b.text),['⚔']);
  removeBadge(c,0);
  assert.ok(!('badges' in c),'no empty list left behind');
  removeBadge(c,null);
  for(const key of ['level','badgeX','badgeY','badgeCustomPosition','badgeColor'])assert.ok(!(key in c),key);
});

test('old layouts: a card with only `level` has exactly one badge',()=>{
  assert.deepEqual(badgeList(card({level:'3'})),[{index:null,text:'3',color:undefined}]);
  assert.deepEqual(badgeList(card({badges:'broken'})),[],'a damaged list is ignored');
});

test('signs and colours are distinct; badges only on boxes with room for them',()=>{
  assert.equal(new Set(SYMBOLS).size,SYMBOLS.length);
  assert.ok(COLORS.every(c=>c.id===''||/^#[0-9a-f]{6}$/.test(c.id)));
  assert.ok(canHaveBadges(card())&&!canHaveBadges({...card(),kind:'shape'}));
});
