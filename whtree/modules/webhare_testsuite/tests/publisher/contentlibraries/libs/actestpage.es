import * as dompack from 'dompack';
import * as beacons from '@mod-publisher/js/contentlibraries/beacons';

if(!window.dataLayer)
  window.dataLayer = [];

function updateBeacons(nd)
{
  if (window.__testdcoptions && window.__testdcoptions.now)
    nd.textContent = `Override test date ${window.__testdcoptions.now.toISOString()}`;
  else
    nd.textContent = `Using current date ${new Date().toISOString()}`;

  const cb = dompack.qS("#currentbeacons");
  cb.replaceChildren(...beacons.list().map( beacon =>
    <div data-beacon-name={beacon.name} data-beacon-when={beacon.timestamps[0]}>
      Beacon: {beacon.name} set at {new Date(beacon.timestamps[0]).toISOString()}
      </div>));

  const count = beacons.getVisitCount();
  const vc = dompack.qS("#visitcount");
  vc.dataset.visitCount = count;
  vc.textContent = `${count} visit${count != 1 ? "s" : ""}`;
}

dompack.register("#nowdate", _ => setInterval(() => updateBeacons(_), 200));
dompack.register("#reload", _ => _.addEventListener("click", () => location.reload()));
dompack.register("#setstudentbeacon", _ => _.addEventListener("click", () => beacons.trigger("is-student")));
dompack.register("#clearstudentbeacon", _ => _.addEventListener("click", () => beacons.clear("is-student")));
dompack.register("#clearemployeebeacon", _ => _.addEventListener("click", () => beacons.clear("is-employee")));
dompack.register("#resetallbeacons", _ => _.addEventListener("click", () => beacons.clear(/^.*$/)));
dompack.register("#resetvisitcount", _ => _.addEventListener("click", () => beacons.resetVisitCount()));
dompack.register("#resetvisitsession", _ => _.addEventListener("click", () => beacons.resetVisitCount({ sessiononly: true })));

dompack.register(".accontent-widget-trailer", trailer =>
{
  trailer.textContent = `Trailer! ${dompack.qSA(".accontent-widget").length} widget(s) in DOM`;
});
