import assert from 'node:assert/strict';
import {calculateStoreSalesTax as tax} from './store-sales-tax.js';
const ship=(county,cents=10000,state='PA')=>tax({fulfillment:'ship',destination:{state,county},taxableCents:cents});
assert.equal(ship('allegheny').taxCents,700);
assert.equal(ship('other_pa').taxCents,600);
assert.equal(ship('philadelphia').taxCents,800);
assert.equal(ship('',10000,'OH').taxCents,0);
for(const fulfillment of ['pickup-monroeville','pickup-wexford'])assert.equal(tax({fulfillment,destination:{state:'PA'},taxableCents:10000}).taxCents,700);
assert.throws(()=>ship(''),/delivery county/);
assert.throws(()=>ship('unknown'),/delivery county/);
assert.throws(()=>ship('',10000,'XX'),/state code/);
assert.throws(()=>ship('allegheny',-1),/Invalid taxable/);
// REV-221 boundary cases; state and local amounts round separately.
for(const [cents,state,one,two] of [[10,0,0,0],[11,1,0,0],[17,1,0,0],[18,2,0,0],[25,2,0,0],[26,2,0,1],[50,3,0,1],[51,4,1,1],[75,5,1,1],[76,5,1,2],[84,5,1,2],[85,6,1,2],[110,6,1,2]]){
 assert.equal(ship('other_pa',cents).taxCents,state);
 assert.equal(ship('allegheny',cents).taxCents,state+one);
 assert.equal(ship('philadelphia',cents).taxCents,state+two);
}
assert.equal(ship('allegheny',4494).taxCents,315); // $29.99 + $14.95 taxable shipping.
assert.equal(ship('allegheny',2999).taxCents,210);
console.log('Pennsylvania tax passed: pickup, destination counties, out-of-state collection policy and statutory rounding brackets.');
