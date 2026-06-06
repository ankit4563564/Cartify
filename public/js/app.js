const paypalButtons = window.paypal.Buttons({
  style: {
    shape: "rect",
    layout: "vertical",
    color: "gold",
    label: "paypal",
  },

  async createOrder() {
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const orderData = await response.json();

      if (orderData.id) {
        return orderData.id;
      }

      const errorDetail = orderData?.details?.[0];
      const errorMessage = errorDetail
        ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`
        : JSON.stringify(orderData);

      throw new Error(errorMessage);
    } catch (error) {
      console.error(error);
      resultMessage(`Could not start PayPal Checkout.<br><br>${error}`);
    }
  },

  async onApprove(data, actions) {
    try {
      const response = await fetch(`/api/orders/${data.orderID}/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const orderData = await response.json();

      const errorDetail = orderData?.details?.[0];

      if (errorDetail?.issue === "INSTRUMENT_DECLINED") {
        return actions.restart();
      } else if (errorDetail) {
        throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
      } else if (!orderData.purchase_units) {
        throw new Error(JSON.stringify(orderData));
      } else {
        const transaction = orderData.purchase_units[0].payments.captures[0];

        window.location.href =
          "/verify_payment?transaction_id=" + transaction.id;
      }
    } catch (error) {
      console.error(error);
      resultMessage(
        `Sorry, your transaction could not be processed.<br><br>${error}`,
      );
    }
  },
});

paypalButtons.render("#paypal-button-container");

function resultMessage(message) {
  const container = document.querySelector("#result-message");
  container.innerHTML = message;
}
