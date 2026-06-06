require("dotenv").config();

var express = require("express");
var ejs = require("ejs");
var bodyParser = require("body-parser");
var { Pool } = require("pg");
var session = require("express-session");
var app = express();

const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "node",
    port: process.env.DB_PORT || 5432,
});

app.use(express.static("public"));
app.set("view engine", "ejs");

app.listen(8080);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(
    session({
        secret: "secret",
    }),
);

function isProductInCart(cart, id) {
    for (let i = 0; i < cart.length; i++) {
        if (cart[i].id == id) {
            return true;
        }
    }
    return false;
}

function calculateTotal(cart, req) {
    let total = 0;
    for (let i = 0; i < cart.length; i++) {
        if (cart[i].sale_price) {
            total = total + cart[i].sale_price * cart[i].quantity;
        } else {
            total = total + cart[i].price * cart[i].quantity;
        }
    }

    req.session.total = total;
    return total;
}

async function getPaypalAccessToken() {
    var auth = Buffer.from(
        process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_CLIENT_SECRET,
    ).toString("base64");

    var response = await fetch(
        "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        {
            method: "POST",
            headers: {
                Authorization: "Basic " + auth,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        },
    );

    var data = await response.json();
    return data.access_token;
}

app.get("/", function (req, res) {
    // Mock data for testing without database
    const mockProducts = [
        { id: 1, name: 'Delicious Pizza', price: 12.99, sale_price: 10.99, image: 'f1.png', category: 'pizza' },
        { id: 2, name: 'Burger Special', price: 8.99, sale_price: 7.99, image: 'f2.png', category: 'burger' },
        { id: 3, name: 'Pasta Delight', price: 15.99, sale_price: 13.99, image: 'f3.png', category: 'pasta' },
        { id: 4, name: 'Fresh Salad', price: 9.99, sale_price: 8.99, image: 'f4.png', category: 'salad' },
        { id: 5, name: 'Tasty Tacos', price: 11.99, sale_price: 9.99, image: 'f5.png', category: 'mexican' },
        { id: 6, name: 'Grilled Chicken', price: 14.99, sale_price: 12.99, image: 'f6.png', category: 'chicken' },
        { id: 7, name: 'Seafood Platter', price: 18.99, sale_price: 15.99, image: 'f7.png', category: 'seafood' },
        { id: 8, name: 'Vegetarian Wrap', price: 10.99, sale_price: 9.99, image: 'f8.png', category: 'vegetarian' },
        { id: 9, name: 'Dessert Special', price: 7.99, sale_price: 6.99, image: 'f9.png', category: 'dessert' }
    ];

    pool.query("SELECT * FROM products", (err, result) => {
        if (err) {
            console.error("Database error, using mock data:", err);
            return res.render("pages/index", { result: mockProducts, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
        }
        res.render("pages/index", { result: result.rows || mockProducts, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
    });
});

app.post("/add_to_cart", function (req, res) {
    var id = req.body.id;
    var name = req.body.name;
    var price = req.body.price;
    var sale_price = req.body.sale_price;
    var quantity = req.body.quantity;
    var image = req.body.image;
    var product = {
        id: id,
        name: name,
        price: price,
        sale_price: sale_price,
        quantity: quantity,
        image: image,
    };

    if (!req.session.cart) {
        req.session.cart = [];
    }

    var cart = req.session.cart;

    if (!isProductInCart(cart, id)) {
        cart.push(product);
    }

    calculateTotal(cart, req);

    res.redirect("/cart");
});

app.get("/cart", function (req, res) {
    var cart = req.session.cart || [];
    var total = req.session.total || 0;

    res.render("pages/cart", { cart: cart, total: total, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.post("/remove_product", function (req, res) {
    var id = req.body.id;
    var cart = req.session.cart || [];

    for (let i = 0; i < cart.length; i++) {
        if (cart[i].id == id) {
            cart.splice(i, 1);
            break;
        }
    }

    calculateTotal(cart, req);

    req.session.cart = cart;

    res.redirect("/cart");
});

app.post("/edit_product_quantity", function (req, res) {
    var id = req.body.id;
    var increase_btn = req.body.increase_product_quantity;
    var decrease_btn = req.body.decrease_product_quantity;

    var cart = req.session.cart;

    for (let i = 0; i < cart.length; i++) {
        if (cart[i].id == id) {
            if (increase_btn) {
                cart[i].quantity = parseInt(cart[i].quantity) + 1;
            }

            if (decrease_btn) {
                if (parseInt(cart[i].quantity) > 1) {
                    cart[i].quantity = parseInt(cart[i].quantity) - 1;
                }
            }

            break;
        }
    }

    calculateTotal(cart, req);
    req.session.cart = cart;
    res.redirect("/cart");
});

app.get("/checkout", function (req, res) {
    var total = req.session.total;

    res.render("pages/checkout", { total: total, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.post("/place_order", function (req, res) {
    var name = req.body.name;
    var email = req.body.email;
    var phone = req.body.phone;
    var city = req.body.city;
    var address = req.body.address;
    var cost = req.session.total;
    var status = "not paid";
    var date = new Date();
    var product_ids = "";
    var id = Date.now();

    req.session.order_id = id;

    var cart = req.session.cart;

    if (!cart || cart.length === 0) {
        return res.redirect("/cart");
    }

    for (let i = 0; i < cart.length; i++) {
        product_ids = product_ids + "," + cart[i].id;
    }

    var query =
        "INSERT INTO orders (id,cost, name, email,status,city ,address,phone,date,product_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)";
    var values = [
        id,
        cost,
        name,
        email,
        status,
        city,
        address,
        phone,
        date,
        product_ids,
    ];

    pool.query(query, values, (err, result) => {
        if (err) {
            console.error("Database error:", err);
            return res.redirect("/checkout");
        }

        var order_id = id;

        for (let i = 0; i < cart.length; i++) {
            var query =
                "INSERT INTO order_items (order_id, product_id,product_name, product_price, product_image, product_quantity,order_date) VALUES ($1, $2, $3, $4, $5, $6, $7)";
            var values = [
                order_id,
                cart[i].id,
                cart[i].name,
                cart[i].price,
                cart[i].image,
                cart[i].quantity,
                new Date(),
            ];

            pool.query(query, values, (err, result) => {
                if (err) {
                    console.error("Database error:", err);
                }
            });
        }

        res.redirect("/payment");
    });
});

app.get("/payment", function (req, res) {
    var total = req.session.total;
    res.render("pages/payment", { total: total, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.post("/api/orders", async function (req, res) {
    try {
        var total = req.session.total;

        if (!total || isNaN(total)) {
            return res.status(400).json({ error: "Invalid total amount" });
        }

        var accessToken = await getPaypalAccessToken();

        var response = await fetch(
            "https://api-m.sandbox.paypal.com/v2/checkout/orders",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + accessToken,
                },
                body: JSON.stringify({
                    intent: "CAPTURE",
                    purchase_units: [
                        {
                            amount: {
                                currency_code: "USD",
                                value: Number(total).toFixed(2),
                            },
                        },
                    ],
                }),
            },
        );

        var data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Failed to create PayPal order" });
    }
});

app.post("/api/orders/:orderID/capture", async function (req, res) {
    try {
        var orderID = req.params.orderID;

        var accessToken = await getPaypalAccessToken();

        var response = await fetch(
            "https://api-m.sandbox.paypal.com/v2/checkout/orders/" +
            orderID +
            "/capture",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + accessToken,
                },
            },
        );

        var data = await response.json();

        if (data.status == "COMPLETED") {
            var query = "UPDATE orders SET status = $1 WHERE id = $2";
            pool.query(query, ["paid", req.session.order_id], (err, result) => {
                if (err) {
                    console.error("Database error:", err);
                }
            });
        }

        res.status(response.status).json(data);
    } catch (error) {
        console.error("PayPal capture error:", error);
        res.status(500).json({ error: "Failed to capture PayPal order" });
    }
});

app.get("/payment_success", function (req, res) {
    req.session.cart = [];
    req.session.total = 0;
    res.send("Payment successful");
});

app.get("/verify_payment", function (req, res) {
    var transaction_id = req.query.transaction_id;
    var order_id = req.session.order_id;

    var query =
        "INSERT INTO payments (order_id, transaction_id, date) VALUES ($1, $2, $3)";

    var values = [order_id, transaction_id, new Date()];

    pool.query(query, values, (err, result) => {
        if (err) {
            console.error("Database error:", err);
            return res.redirect("/thank_you");
        }

        pool.query(
            "UPDATE orders SET status = $1 WHERE id = $2",
            ["paid", order_id],
            (err, result) => {
                if (err) {
                    console.error("Database error:", err);
                }

                res.redirect("/thank_you");
            },
        );
    });
});

app.get("/thank_you", function (req, res) {
    var order_id = req.session.order_id;
    res.render("pages/thank_you", { order_id, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.get("/single_product", function (req, res) {
    var id = req.query.id;

    // Mock data for testing without database
    const mockProducts = [
        { id: 1, name: 'Delicious Pizza', price: 12.99, sale_price: 10.99, image: 'f1.png', category: 'pizza' },
        { id: 2, name: 'Burger Special', price: 8.99, sale_price: 7.99, image: 'f2.png', category: 'burger' },
        { id: 3, name: 'Pasta Delight', price: 15.99, sale_price: 13.99, image: 'f3.png', category: 'pasta' },
        { id: 4, name: 'Fresh Salad', price: 9.99, sale_price: 8.99, image: 'f4.png', category: 'salad' },
        { id: 5, name: 'Tasty Tacos', price: 11.99, sale_price: 9.99, image: 'f5.png', category: 'mexican' },
        { id: 6, name: 'Grilled Chicken', price: 14.99, sale_price: 12.99, image: 'f6.png', category: 'chicken' },
        { id: 7, name: 'Seafood Platter', price: 18.99, sale_price: 15.99, image: 'f7.png', category: 'seafood' },
        { id: 8, name: 'Vegetarian Wrap', price: 10.99, sale_price: 9.99, image: 'f8.png', category: 'vegetarian' },
        { id: 9, name: 'Dessert Special', price: 7.99, sale_price: 6.99, image: 'f9.png', category: 'dessert' }
    ];

    pool.query("SELECT * FROM products WHERE id = $1", [id], (err, result) => {
        if (err) {
            console.error("Database error, using mock data:", err);
            const product = mockProducts.find(p => p.id == id) || mockProducts[0];
            return res.render("pages/single_product", { result: [product], googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
        }
        res.render("pages/single_product", { result: result.rows || [], googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
    });
});

app.get("/products", function (req, res) {
    // Mock data for testing without database
    const mockProducts = [
        { id: 1, name: 'Delicious Pizza', price: 12.99, sale_price: 10.99, image: 'f1.png', category: 'pizza' },
        { id: 2, name: 'Burger Special', price: 8.99, sale_price: 7.99, image: 'f2.png', category: 'burger' },
        { id: 3, name: 'Pasta Delight', price: 15.99, sale_price: 13.99, image: 'f3.png', category: 'pasta' },
        { id: 4, name: 'Fresh Salad', price: 9.99, sale_price: 8.99, image: 'f4.png', category: 'salad' },
        { id: 5, name: 'Tasty Tacos', price: 11.99, sale_price: 9.99, image: 'f5.png', category: 'mexican' },
        { id: 6, name: 'Grilled Chicken', price: 14.99, sale_price: 12.99, image: 'f6.png', category: 'chicken' },
        { id: 7, name: 'Seafood Platter', price: 18.99, sale_price: 15.99, image: 'f7.png', category: 'seafood' },
        { id: 8, name: 'Vegetarian Wrap', price: 10.99, sale_price: 9.99, image: 'f8.png', category: 'vegetarian' },
        { id: 9, name: 'Dessert Special', price: 7.99, sale_price: 6.99, image: 'f9.png', category: 'dessert' }
    ];

    pool.query("SELECT * FROM products", (err, result) => {
        if (err) {
            console.error("Database error, using mock data:", err);
            return res.render("pages/products", { result: mockProducts, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
        }
        res.render("pages/products", { result: result.rows || mockProducts, googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
    });
});

app.get("/about", function (req, res) {
    res.render("pages/about", { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});
