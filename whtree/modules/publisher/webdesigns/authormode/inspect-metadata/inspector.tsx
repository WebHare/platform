import * as dompack from "@webhare/dompack";
import "./inspector.css";
import { omit } from "@webhare/std";

interface Error {
  message: string;
  element: HTMLElement | null;
}

interface Metadata {
  field: string;
  value: unknown;
  element: HTMLElement;
}

function gatherSchemaOrgData() {
  const errors: Error[] = [];
  const metadata: Metadata[] = [];

  for (const scriptelement of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(scriptelement.textContent!);
      if (data['@context'].match(/^https?:\/\/schema.org/)) {
        if (data['@type'])
          metadata.push({ field: "schema.org " + data["@type"], value: omit(data, ["@context", "@type"]), element: scriptelement });
        else
          errors.push({ message: `No @type in schema.org data`, element: scriptelement });
      } else
        errors.push({ message: `Unknown context ${data['@context']}`, element: scriptelement });
    } catch (e) {
      errors.push({ message: `Cannot parse schema.org data`, element: scriptelement });
    }
  }

  return { errors, metadata };
}

function gatherHeadData() {
  const errors: Error[] = [];
  const metadata: Metadata[] = [];

  if (document.title)
    metadata.push({ field: "Document title", value: document.title, element: dompack.qR("title") });
  else
    errors.push({ message: "No document title", element: null });

  return { errors, metadata };
}

export async function inspectMetadata(event: MouseEvent | null) {
  event?.preventDefault(); //don't transfer focus to the inspect button

  const allerrors = [];
  const allmetadata = [];

  {
    const { errors, metadata } = gatherSchemaOrgData();
    allerrors.push(...errors);
    allmetadata.push(...metadata);
  }

  {
    const { errors, metadata } = gatherHeadData();
    allerrors.push(...errors);
    allmetadata.push(...metadata);
  }

  const metadialog = <dialog class="wh-metadata-insepctor">
    <h2>Metadata</h2>
    <pre>
      {allmetadata.map((m) => `${m.field}: ${JSON.stringify(m.value, null, 2)}`).join("\n\n") + "\n"}
    </pre>
    {allerrors.length ?
      <pre>
        Errors: {JSON.stringify(allerrors, null, 2)}
      </pre> : null}
    <form method="dialog"><button>close</button></form>
  </dialog>;
  document.body.append(metadialog);
  metadialog.showModal();
}
