importScripts("https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.4/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.4/dist/wheels/panel-0.14.4-py3-none-any.whl', 'pyodide-http==0.1.0', 'holoviews>=1.15.4', 'hvplot', 'io', 'numpy', 'pandas']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }

  response = await fetch(
    "https://raw.githubusercontent.com/ddalgotrader/control_trading_costs_repo/docs/spreads_df.csv"
  );
  response.ok && response.status === 200
    ? (spreads = await response.text())
    : (spreads = "");
  // define global variable called titles to make it accessible by Python
  self.pyodide.globals.set("spreadsCSV", spreads);

  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import panel as pn
import hvplot.pandas
import numpy as np
import pandas as pd
pn.extension(sizing_mode="stretch_width")
import io


#pn.extension(template='fast-list')
#spreads_df=pd.read_csv('https://storage.googleapis.com/charts-ddalgotrader/spreads_df.csv', parse_dates=['date'], index_col='date')
csv_buffer = io.StringIO(spreadsCSV)
spreads_df=pd.read_csv(csv_buffer, parse_dates=['date'], index_col='date')
cols = list(spreads_df.columns)
currency = pn.widgets.Select(name='currency', options=cols)
day = pn.widgets.Select(name='day', options=list(spreads_df['weekday'].unique()))


@pn.depends(currency.param.value, day.param.value)
def get_spreads(currency, day):
    day_spreads = spreads_df.loc[spreads_df['weekday'] == day, currency]

    df_dict = {'spread': day_spreads.values,
               'hour': day_spreads.index.hour}

    df = pd.DataFrame(df_dict)

    return df.hvplot.line('hour', 'spread', yformatter='%.5f', xlabel=day, grid=True, responsive=True, height=500,
                          width=500)




pn.Row(pn.WidgetBox(currency, day), width=300, background='WhiteSmoke'),
pn.Row(get_spreads)


currency.servable(area='sidebar')
day.servable(area='sidebar')



pn.panel(pn.bind(get_spreads, currency, day)).servable(title='Comparison of spreads');

await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()
