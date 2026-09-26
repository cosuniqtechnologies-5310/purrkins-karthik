require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
// Allow requests from the Shopify store (since we might test it directly via fetch first)
app.use(cors({ origin: '*' }));

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// ==========================================
// HELPER: SHOPIFY GRAPHQL EXECUTOR
// ==========================================
async function shopifyGraphQL(query, variables = {}) {
    const fetch = (await import('node-fetch')).default; // Use dynamic import if using newer node, or just use native fetch in Node 18+
    
    // We'll use the native global fetch available in Node.js 18+
    const response = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ADMIN_API_TOKEN,
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    if (data.errors) {
        throw new Error(data.errors[0].message);
    }
    if (data.data.customerUpdate?.userErrors?.length > 0) {
         throw new Error(data.data.customerUpdate.userErrors[0].message);
    }
    if (data.data.customerCreate?.userErrors?.length > 0) {
         throw new Error(data.data.customerCreate.userErrors[0].message);
    }
    return data.data;
}

// ==========================================
// MAIN ENDPOINT: /api/shopify/proxy/customer
// ==========================================
app.post('/api/shopify/proxy/customer', async (req, res) => {
    try {
        const { name, phone } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'Name and Phone are required' });
        }

        console.log(`Processing customer: Name=${name}, Phone=${phone}`);

        // STEP 1: Search if customer already exists by phone
        const searchQuery = `
            query findCustomer($query: String!) {
                customers(first: 1, query: $query) {
                    edges {
                        node {
                            id
                            firstName
                            phone
                        }
                    }
                }
            }
        `;
        
        const searchResult = await shopifyGraphQL(searchQuery, { query: `phone:${phone}` });
        const existingCustomer = searchResult.customers.edges[0]?.node;

        let responseCustomer = null;

        if (existingCustomer) {
            console.log(`Found existing customer: ${existingCustomer.id}`);
            // STEP 2A: Update existing customer
            const updateMutation = `
                mutation updateCustomer($input: CustomerInput!) {
                    customerUpdate(input: $input) {
                        customer {
                            id
                            firstName
                            phone
                        }
                        userErrors { message }
                    }
                }
            `;
            
            const updateResult = await shopifyGraphQL(updateMutation, {
                input: {
                    id: existingCustomer.id,
                    firstName: name,
                    phone: phone
                }
            });
            responseCustomer = updateResult.customerUpdate.customer;
            console.log(`Updated customer successfully.`);

        } else {
            console.log(`No existing customer found. Creating new one.`);
            // STEP 2B: Create new customer
            const randomId = Date.now().toString().slice(-8);
            const placeholderEmail = `lead-${randomId}@noemail.purrkins.com`;

            const createMutation = `
                mutation createCustomer($input: CustomerInput!) {
                    customerCreate(input: $input) {
                        customer {
                            id
                            firstName
                            phone
                            email
                        }
                        userErrors { message }
                    }
                }
            `;
            
            const createResult = await shopifyGraphQL(createMutation, {
                input: {
                    firstName: name,
                    phone: phone,
                    email: placeholderEmail,
                    tags: ["free-sample-claim"]
                }
            });
            responseCustomer = createResult.customerCreate.customer;
            console.log(`Created new customer successfully: ${responseCustomer.id}`);
        }

        // Return success response
        return res.json({
            success: true,
            customer: responseCustomer
        });

    } catch (error) {
        console.error('Customer API Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Unable to save customer',
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Backend Server running on port ${PORT}`);
    console.log(`=========================================`);
    console.log(`Test endpoint: http://localhost:${PORT}/api/shopify/proxy/customer`);
});
