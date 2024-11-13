import { IntemptJs } from '../src/intemptJs/intemptJs.ts';
import { generateId } from '../src/shared/shared.utils.ts';


const organization="intempt2";
const project="intempt2_project";
const sourceId="690046034731970560";
const writeKey="7a517765039b44f0892702d897fddf12.6b2f3523a34b41eb9112aac96d2dc236";
const apiUrl = "https://api.staging.intempt.com/v1";


let intempt: IntemptJs;

describe('Intempt SDK Custom Method Tests', () => {
  before(() => {
    // Set the environment variable for this test suite
    Cypress.env('VITE_API', "https://api.staging.intempt.com/v1");

    intempt = new IntemptJs({
      organization,
      project,
      sourceId,
      writeKey,
    })

  });

  it('should invoke productAdd without error', async () => {
    const methodType = 'POST'
    const url = `${apiUrl}/${organization}/projects/${project}/consents/data`

    cy.intercept(
      methodType,
      url,
      (req) => {
        req.reply({
          status: 200,
          body: {
            success: true
          }
        })
      }
    ).as('track')

    intempt.productAdd({
      productId: generateId(),
      quantity: 1
    })


    cy.wait('@track');

  })
})
