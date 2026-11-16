import { Customer, Order, Product } from "../types";
import { getInMemoryIdToken } from "../src/lib/tokenStore";

export const getMarketingInsights = async (
  customer: Customer,
  _recentOrders: Order[],
  products: Product[]
) => {
  try {
    const token = await getInMemoryIdToken();
    if (!token) {
      return "يرجى تسجيل الدخول أولاً لتوليد الرسائل التسويقية.";
    }

    const response = await fetch("/api/marketing-insight", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ customer, products }),
    });

    if (!response.ok) {
      return "عذراً، حدث خطأ أثناء توليد الاقتراحات التسويقية.";
    }

    const data = await response.json();
    return data.text || "لا تتوفر اقتراحات تسويقية حالياً.";
  } catch (error) {
    console.error("Marketing insight error:", error);
    return "عذراً، حدث خطأ أثناء توليد الاقتراحات التسويقية.";
  }
};

export const classifyCustomerAI = async (customerData: { totalSpent: number }) => {
  return customerData.totalSpent > 10000
    ? "ذهبي"
    : customerData.totalSpent > 5000
    ? "فضي"
    : "عادي";
};
