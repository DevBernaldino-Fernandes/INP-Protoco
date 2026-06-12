const axios = require('axios');

async function test() {
  try {
    console.log('--- Processing Multiline DSL Intent ---');
    const dslText = `
INTENT "buy_product" {
  CONTEXT { amount: 125, user_id: "usr_99" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const dslRes = await axios.post('http://localhost:3000/api/intent', {
      text: dslText,
      type: 'dsl'
    });
    console.log('DSL Execution Result:', JSON.stringify(dslRes.data, null, 2));

  } catch (err) {
    console.error('Test failed:', err.response ? err.response.data : err.message);
  }
}

test();
