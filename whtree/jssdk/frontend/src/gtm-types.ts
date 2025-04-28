/* GTM ECommerce definitions:
    https://developers.google.com/analytics/devguides/collection/ga4/ecommerce?client_type=gtm
    https://developers.google.com/analytics/devguides/collection/ga4/reference/events?client_type=gtm

    We currently only have explicit ecommerce definitions for webshop-related events
*/

export type EcommerceItemInfo = {
  /** The ID of the item. *One of item_id or item_name is required. */
  item_id?: string;
  /** The name of the item. *One of item_id or item_name is required. */
  item_name?: string;
  /** A product affiliation to designate a supplying company or brick and mortar store location. Note: `affiliation` is only available at the item-scope. */
  affiliation?: string;
  /** The coupon name/code associated with the item. Event-level and item-level coupon parameters are independent. */
  coupon?: string;
  /** The unit monetary discount value associated with the item. */
  discount?: number;
  /** The index/position of the item in a list. */
  index?: number;
  /**  The brand of the item.*/
  item_brand?: string;
  /** The category of the item. If used as part of a category hierarchy or taxonomy then this will be the first category. */
  item_category?: string;
  /** The second category hierarchy or additional taxonomy for the item.  */
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  /** The ID of the list in which the item was presented to the user. If set, event-level item_list_id is ignored. If not set, event-level item_list_id is used, if present. */
  item_list_id?: string;
  /** The name of the list in which the item was presented to the user. If set, event-level item_list_name is ignored. If not set, event-level item_list_name is used, if present. */
  item_list_name?: string;
  /** The item variant or unique code or description for additional item details/options. */
  item_variant?: string;
  /** The physical location associated with the item (e.g. the physical store location). It's recommended to use the Google Place ID that corresponds to the associated item. A custom location ID can also be used. Note: `location id` is only available at the item-scope. */
  location_id?: string;
  /** The monetary unit price of the item, in units of the specified currency parameter. If a discount applies to the item, set price to the discounted unit price and specify the unit price discount in the discount parameter.*/
  price?: number;
  /** Item quantity. If not set, quantity is set to 1. */
  quantity?: number;
} & ({ item_id: string } | { item_name: string });

type EcommerceObject = {
  /** Currency of the items associated with the event, in 3-letter ISO 4217 format. */
  currency: "EUR" | "USD" | string;
  /** Set value to the sum of (price * quantity) for all items in items. Don't include shipping or tax. */
  value?: number;
  /** The items for the event. */
  items: EcommerceItemInfo[];
};

export type EcommerceDataLayerPurchaseEntry = {
  event: "purchase" | "refund";
  ecommerce: EcommerceObject & {
    coupon?: string;
    /** The unique identifier of a transaction. */
    transaction_id: string;
    /** Shipping cost associated with a transaction. */
    shipping?: number;
    /** Tax cost associated with a transaction. */
    tax?: number;
  };
};

export type EcommerceDataLayerViewItemEntry = {
  event: "view_item_list";
  ecommerce: EcommerceObject & {
    item_list_id?: string;
    item_list_name?: string;
  };
};

export type EcommerceDataLayerSearchEntry = {
  event: "search";
  search_term: string;
};

export type EcommerceDataLayerAddToCartEntry = {
  event: "add_to_cart" | "add_to_wishlist" | "remove_from_cart" | "view_cart" | "view_item";
  ecommerce: EcommerceObject & {
    coupon?: string;
  };
};

export type EcommerceDataLayerAddPaymentInfoEntry = {
  event: "add_payment_info";
  ecommerce: EcommerceObject & {
    coupon?: string;
    payment_type?: string;
  };
};

export type EcommerceDataLayerAddShippingInfoEntry = {
  event: "add_shipping_info";
  ecommerce: EcommerceObject & {
    coupon?: string;
    shipping_tier?: string;
  };
};

export type EcommerceDataLayerBeginCheckoutEntry = {
  event: "begin_checkout";
  ecommerce: EcommerceObject & {
    coupon?: string;
    shipping_tier?: string;
  };
};

export type EcommerceDataLayerSelectItemEntry = {
  event: "select_item";
  ecommerce: {
    item_list_id?: string;
    item_list_name?: string;
    items: EcommerceItemInfo[];
  };
};

export type EcommerceDataLayerEntry =
  EcommerceDataLayerAddPaymentInfoEntry |
  EcommerceDataLayerAddShippingInfoEntry |
  EcommerceDataLayerAddToCartEntry |
  EcommerceDataLayerBeginCheckoutEntry |
  EcommerceDataLayerPurchaseEntry |
  EcommerceDataLayerViewItemEntry |
  EcommerceDataLayerSearchEntry |
  EcommerceDataLayerSelectItemEntry;

export type DataLayerVar = boolean | string | number | { [key: string]: DataLayerVar } | DataLayerVar[];

//FIXME only eventCallback should be a ()=>void ..
export type DataLayerEntry = { [key in string]?: DataLayerVar | (() => void) } & {
  event?: string;
  eventCallback?: () => void;
} & ({ event?: string; ecommerce?: never } | EcommerceDataLayerEntry); //ensure that any 'ecommerce' object triggers valiadtion
