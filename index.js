require("dotenv").config();

var express = require("express");
var ejs = require("ejs");
var bodyParser = require("body-parser");
var mysql = require("mysql");
var session = require("express-session");
var app = express();

mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "node",
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
    var con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "node",
    });

    con.query("SELECT * FROM products", (err, result) => {
        res.render("pages/index", { result: result });
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

    res.render("pages/cart", { cart: cart, total: total });
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

    res.render("pages/checkout", { total: total });
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

    var con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "node",
    });

    var cart = req.session.cart;

    if (!cart || cart.length === 0) {
        return res.redirect("/cart");
    }

    for (let i = 0; i < cart.length; i++) {
        product_ids = product_ids + "," + cart[i].id;
    }

    con.connect((err) => {
        if (err) {
            console.log(err);
        } else {
            var query =
                "INSERT INTO orders (id,cost, name, email,status,city ,address,phone,date,product_ids) VALUES ?";
            var values = [
                [
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
                ],
            ];

            con.query(query, [values], (err, result) => {
                if (err) {
                    console.log(err);
                    return res.redirect("/checkout");
                }

                var order_id = id;

                for (let i = 0; i < cart.length; i++) {
                    var query =
                        "INSERT INTO order_items (order_id, product_id,product_name, product_price, product_image, product_quantity,order_date) VALUES ?";
                    var values = [
                        [
                            order_id,
                            cart[i].id,
                            cart[i].name,
                            cart[i].price,
                            cart[i].image,
                            cart[i].quantity,
                            new Date(),
                        ],
                    ];

                    con.query(query, [values], (err, result) => {
                        if (err) {
                            console.log(err);
                        }
                    });
                }

                res.redirect("/payment");
            });
        }
    });
});

app.get("/payment", function (req, res) {
    var total = req.session.total;
    res.render("pages/payment", { total: total });
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
            var con = mysql.createConnection({
                host: "localhost",
                user: "root",
                password: "",
                database: "node",
            });

            var query = "UPDATE orders SET status = ? WHERE id = ?";
            con.query(query, ["paid", req.session.order_id], (err, result) => {
                if (err) {
                    console.log(err);
                }
            });
        }

        res.status(response.status).json(data);
    } catch (error) {
        console.log(error);
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

    var con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "node",
    });

    con.connect((err) => {
        if (err) {
            console.log(err);
            return res.redirect("/thank_you");
        }

        var query =
            "INSERT INTO payments (order_id, transaction_id, date) VALUES ?";

        var values = [[order_id, transaction_id, new Date()]];

        con.query(query, [values], (err, result) => {
            if (err) {
                console.log(err);
                return res.redirect("/thank_you");
            }

            con.query(
                "UPDATE orders SET status = ? WHERE id = ?",
                ["paid", order_id],
                (err, result) => {
                    if (err) {
                        console.log(err);
                    }

                    res.redirect("/thank_you");
                },
            );
        });
    });
});

app.get("/thank_you", function (req, res) {
    var order_id = req.session.order_id;
    res.render("pages/thank_you", { order_id });
});

app.get("/single_product", function (req, res) {
    var id = req.query.id;

    var con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "node",
    });

    con.query("SELECT * FROM products WHERE id = ?", [id], (err, result) => {
        res.render("pages/single_product", { result: result });
    });
});

app.get("/products", function (req, res) {
    var con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "node",
    });

    con.query("SELECT * FROM products", (err, result) => {
        res.render("pages/products", { result: result });
    });
});

app.get("/about", function (req, res) {
    res.render("pages/about");
});
