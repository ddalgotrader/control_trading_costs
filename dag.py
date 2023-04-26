from airflow import DAG
from datetime import datetime
from airflow.providers.google.cloud.transfers.gcs_to_local import GCSToLocalFilesystemOperator
from airflow.providers.google.cloud.transfers.local_to_gcs import LocalFilesystemToGCSOperator

from xAPIConnector import *
import pandas as pd
from airflow.operators.python import PythonOperator


DEFAULT_ARGS = {
    'owner': 'airflow',
    'depends_on_past': False,

}
dag = DAG('gcs_test',
          default_args=DEFAULT_ARGS,
          start_date=datetime(2023, 4, 24),  #please define your own start date
          schedule_interval='30 * * * 1-5'
          

          )

symbols_df=pd.read_csv('/path/to/file/symbols.csv')



def extract(**kwargs):
    ti = kwargs['ti']
    client = APIClient()
    client.execute(loginCommand(userId=XTB_ACCOUNT_ID, password='XTB_PASSWORD'))
    spreads = {'data': []}
    date_time = datetime.now().strftime('%Y-%m-%d %H:%M:00')

    for i in range(len(symbols_df)):
        try:
            
            sym_dict = {}
            symbol = symbols_df['symbol'].iloc[i]
            time.sleep(0.5)
            data_sym = client.commandExecute('getSymbol', arguments={'symbol': symbol})
            date_time_pd = pd.to_datetime(date_time)
            spread = data_sym['returnData']['spreadRaw']
            pips = data_sym['returnData']['spreadTable']

            sym_dict['date'] = date_time
            sym_dict['symbol'] = symbol
            sym_dict['spread'] = spread
            sym_dict['pips'] = pips-100

            spreads['data'].append(sym_dict)
        except KeyError:
            continue
    ti.xcom_push('spreads', spreads)


def transform(**kwargs):

    ti = kwargs['ti']
    spreads = ti.xcom_pull(task_ids='extract', key='spreads')
    df=pd.DataFrame.from_records(spreads['data'])
    df_from_gcs=pd.read_csv('/path/to/file/spreads_xtb.csv')  #path to file on local disk
    df_to_gcs=pd.concat([df, df_from_gcs], ignore_index=True)
    df_to_gcs.to_csv('/path/to/file/spreads_xtb.csv', index=False)





download_file = GCSToLocalFilesystemOperator(
    task_id="download_file",
    object_name='spreads_xtb.csv',
    bucket='your-bucket-name',
    filename='/path/to/file/spreads_xtb.csv',
    dag=dag
    )

extract_task = PythonOperator(
    task_id='extract',
    python_callable=extract,
    dag=dag,
)

transform = PythonOperator(
    task_id='transform',
    python_callable=transform,
    dag=dag,
)

upload_file = LocalFilesystemToGCSOperator(
    task_id="upload_file",
    src='/path/to/file/spreads_xtb.csv',
    dst='spreads_xtb.csv',
    bucket='your-bucket-name',
    dag=dag

    )


download_file>>extract_task>>transform>>upload_file
